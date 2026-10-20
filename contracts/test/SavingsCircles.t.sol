// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SavingsCircles} from "../SavingsCircles.sol";

// ---------------------------------------------------------------------------
// Mock USDC (normal)
// ---------------------------------------------------------------------------
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
}

// ---------------------------------------------------------------------------
// Reverting token: transfer() always reverts for one address.
// Used to test that collect() is robust to transfer failures.
// ---------------------------------------------------------------------------
contract RevertingToken is ERC20 {
    address public revertFor;
    constructor() ERC20("Reverting", "RVRT") {}
    function setRevertFor(address a) external { revertFor = a; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (from == revertFor) revert("blocked");
        return super.transferFrom(from, to, amount);
    }
}

// ---------------------------------------------------------------------------
// Reentrant token: on transfer() it tries to re-enter sc.withdraw().
// Used to test the reentrancy guard on withdraw().
// ---------------------------------------------------------------------------
contract ReentrantToken is ERC20 {
    SavingsCircles public sc;
    bool public attacking;
    constructor() ERC20("Reentrant", "RTKN") {}
    function setSC(address sc_) external { sc = SavingsCircles(sc_); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (!attacking) {
            attacking = true;
            try sc.withdraw() {} catch {}
            attacking = false;
        }
        return super.transfer(to, amount);
    }
}

// ---------------------------------------------------------------------------
// Main test contract
// ---------------------------------------------------------------------------
contract SavingsCirclesTest is Test {
    MockUSDC       internal usdc;
    SavingsCircles internal sc;

    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave  = makeAddr("dave");

    uint256 internal constant CONTRIBUTION  = 100e6;  // 100 USDC
    uint64  internal constant PERIOD_LENGTH = 1 days;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Fund `who` with `amount` USDC and approve the contract for unlimited spend.
    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(sc), type(uint256).max);
    }

    /// Create a circle and return its id.
    function _createCircle(uint8 size, uint8 depositPeriods) internal returns (uint256 id) {
        id = sc.createCircle(CONTRIBUTION, PERIOD_LENGTH, size, depositPeriods, new address[](0));
    }

    /// Assert contract USDC balance == sum of all pots + all deposits + all claimable.
    /// (This can only check the accounts we supply; caller must pass all relevant addresses.)
    function _assertBalanceInvariant(uint256[] memory ids, address[] memory accounts) internal view {
        uint256 totalPot;
        for (uint256 i; i < ids.length; ++i) {
            SavingsCircles.CircleView memory v = sc.getCircle(ids[i]);
            totalPot += v.pot;
            for (uint256 j; j < accounts.length; ++j) {
                SavingsCircles.MemberInfo memory m = sc.memberInfo(ids[i], accounts[j]);
                totalPot += m.deposit;
            }
        }
        uint256 totalClaimable;
        for (uint256 j; j < accounts.length; ++j) {
            totalClaimable += sc.claimable(accounts[j]);
        }
        assertEq(
            usdc.balanceOf(address(sc)),
            totalPot + totalClaimable,
            "balance invariant violated"
        );
    }

    /// Assert reputation fields.
    function _assertRep(
        address who,
        uint256 cyclesCompleted,
        uint256 onTime,
        uint256 late,
        uint256 missed,
        uint256 defaults_
    ) internal view {
        (
            uint256 cc,
            uint256 ot,
            uint256 lp,
            uint256 mp,
            uint256 df
        ) = _rep(who);
        assertEq(cc, cyclesCompleted, "cyclesCompleted");
        assertEq(ot, onTime,          "onTimePayments");
        assertEq(lp, late,            "latePayments");
        assertEq(mp, missed,          "missedPayments");
        assertEq(df, defaults_,       "defaults");
    }

    function _rep(address who) internal view returns (uint256, uint256, uint256, uint256, uint256) {
        (
            uint256 cyclesCompleted,
            uint256 onTimePayments,
            uint256 latePayments,
            uint256 missedPayments,
            uint256 defaults_
        ) = sc.reputation(who);
        return (cyclesCompleted, onTimePayments, latePayments, missedPayments, defaults_);
    }

    // -----------------------------------------------------------------------
    // setUp — runs before every test
    // -----------------------------------------------------------------------
    function setUp() public {
        usdc = new MockUSDC();
        sc   = new SavingsCircles(address(usdc));
        vm.warp(1_000_000); // start at a non-zero timestamp
    }

    // =======================================================================
    // Test 1 — Happy path: 3 members on autopay, payouts requested out of
    //          join order (Carol, Alice, Bob), each receives exactly payout,
    //          settle, everyone withdraws claimable, contract holds deposits.
    // =======================================================================
    function test_happyPath() public {
        // Each member:
        //   deposit = 1 × 100 = 100e6 (locked, stays for next cycle)
        //   contributions = 3 × 100 = 300e6
        //   total spent from wallet = 400e6
        //   received back as claimable = 300e6 (payout)
        //   net wallet after withdraw = start - 400 + 300 = start - 100
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);

        // State is Pending — manual startCycle required
        SavingsCircles.CircleView memory v = sc.getCircle(id);
        assertEq(uint8(v.state), uint8(SavingsCircles.CircleState.Pending));
        assertEq(v.memberCount, 3);
        assertEq(sc.memberInfo(id, alice).deposit, 100e6);
        assertEq(sc.memberInfo(id, bob).deposit,   100e6);
        assertEq(sc.memberInfo(id, carol).deposit, 100e6);

        sc.startCycle(id);
        v = sc.getCircle(id);
        assertEq(uint8(v.state), uint8(SavingsCircles.CircleState.Active));
        assertEq(v.cycle, 1);

        uint256[] memory ids = new uint256[](1); ids[0] = id;
        address[] memory accs = new address[](3); accs[0] = alice; accs[1] = bob; accs[2] = carol;

        uint64 cs = v.cycleStart;

        // ---- Period 0: collect. Each owes 1 contribution. ----
        sc.collect(id);
        assertEq(sc.memberInfo(id, alice).paidThisCycle, 100e6);
        assertEq(sc.memberInfo(id, bob).paidThisCycle,   100e6);
        assertEq(sc.memberInfo(id, carol).paidThisCycle, 100e6);
        assertEq(sc.getCircle(id).pot, 300e6);
        _assertBalanceInvariant(ids, accs);

        // Carol requests payout first (out of join order)
        vm.prank(carol); sc.request(id);
        assertEq(sc.claimable(carol), 300e6, "carol claimable");
        assertEq(sc.getCircle(id).pot, 0);
        _assertBalanceInvariant(ids, accs);

        // ---- Period 1: collect, Alice requests. ----
        vm.warp(uint256(cs) + PERIOD_LENGTH);
        sc.collect(id);
        assertEq(sc.getCircle(id).pot, 300e6, "pot refilled period 1");
        vm.prank(alice); sc.request(id);
        assertEq(sc.claimable(alice), 300e6, "alice claimable");
        _assertBalanceInvariant(ids, accs);

        // ---- Period 2: collect, Bob requests. ----
        vm.warp(uint256(cs) + 2 * PERIOD_LENGTH);
        sc.collect(id);
        assertEq(sc.getCircle(id).pot, 300e6, "pot refilled period 2");
        vm.prank(bob); sc.request(id);
        assertEq(sc.claimable(bob), 300e6, "bob claimable");
        _assertBalanceInvariant(ids, accs);

        // ---- Settle ----
        vm.warp(uint256(cs) + 3 * PERIOD_LENGTH + 1);
        sc.settleCycle(id);
        assertEq(uint8(sc.getCircle(id).state), uint8(SavingsCircles.CircleState.Pending));

        // Deposits are NOT returned — they stay locked for the next cycle
        assertEq(sc.memberInfo(id, alice).deposit, 100e6, "alice deposit still locked");
        assertEq(sc.memberInfo(id, bob).deposit,   100e6, "bob deposit still locked");
        assertEq(sc.memberInfo(id, carol).deposit, 100e6, "carol deposit still locked");

        _assertBalanceInvariant(ids, accs);

        // Withdraw claimable (payouts only — deposits stay in contract)
        vm.prank(carol); sc.withdraw();
        vm.prank(alice); sc.withdraw();
        vm.prank(bob);   sc.withdraw();

        // Wallet balances: started 400, paid deposit(100) + 3 contribs(300) = 400, got back 300
        // Net = 400 - 400 + 300 = 300 each. Deposits (100 each = 300 total) still locked.
        assertEq(usdc.balanceOf(alice), 300e6, "alice net 300 (deposit locked)");
        assertEq(usdc.balanceOf(bob),   300e6, "bob net 300 (deposit locked)");
        assertEq(usdc.balanceOf(carol), 300e6, "carol net 300 (deposit locked)");
        // Contract holds the 3 deposits
        assertEq(usdc.balanceOf(address(sc)), 300e6, "contract holds 3 deposits");

        _assertRep(alice, 1, 3, 0, 0, 0);
        _assertRep(bob,   1, 3, 0, 0, 0);
        _assertRep(carol, 1, 3, 0, 0, 0);
    }

    // =======================================================================
    // Test 2 — request() reverts: PotTooSmall, AlreadyTaken, HasArrears,
    //          NotMember, not Active.
    // =======================================================================
    function test_requestReverts() public {
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);

        // Not Active → InvalidState
        vm.prank(alice);
        vm.expectRevert(SavingsCircles.InvalidState.selector);
        sc.request(id);

        sc.startCycle(id);

        // Non-member → NotMember
        vm.prank(dave);
        vm.expectRevert(SavingsCircles.NotMember.selector);
        sc.request(id);

        // HasArrears: use a fresh member (alice2) with 0 balance who cannot pay.
        // alice2 will have deposit but 0 USDC left after joining → cannot pay period 0.
        address alice2 = makeAddr("alice2");
        address bob2   = makeAddr("bob2");
        address carol2 = makeAddr("carol2");
        usdc.mint(alice2, 100e6); vm.prank(alice2); usdc.approve(address(sc), type(uint256).max);
        _fund(bob2,   400e6);
        _fund(carol2, 400e6);

        uint256 id2 = _createCircle(3, 1);
        vm.prank(alice2); sc.join(id2); // deposit=100, balance now=0
        vm.prank(bob2);   sc.join(id2);
        vm.prank(carol2); sc.join(id2);
        sc.startCycle(id2);

        // alice2 has 0 balance; _collectAll inside request cannot pull from her
        // → alice2 still owes period 0 → HasArrears
        vm.prank(alice2);
        vm.expectRevert(SavingsCircles.HasArrears.selector);
        sc.request(id2);

        // Collect for original circle so everyone has zero arrears.
        sc.collect(id);
        assertEq(sc.memberInfo(id, alice).owedNow, 0);

        // AlreadyTaken: alice requests successfully, then tries again.
        vm.prank(alice); sc.request(id); // succeeds, pot was 300 = payout
        vm.prank(alice);
        vm.expectRevert(SavingsCircles.AlreadyTaken.selector);
        sc.request(id);

        // PotTooSmall: pot is 0 after alice took it; bob tries but pot < payout.
        // bob has funds so _collectAll will pull from everyone, filling pot with 300 more.
        // To get PotTooSmall, warp to period 1 and 2 first (so bob and carol have already
        // paid 2 periods each) then check a zero-balance scenario.
        // Simpler: use id2 where alice2 has 0 (can't pay). bob2/carol2 pay via collect,
        // then alice2 tries to request — alice2 still owes (HasArrears).
        // For PotTooSmall with no arrears: alice2 somehow pays off arrears but pot is
        // depleted by the one payout limit. Use a 2-member circle where pot = payout only
        // when both pay; if only one pays and the other already took, pot < payout.
        address a = makeAddr("a");
        address b = makeAddr("b");
        _fund(a, 400e6);
        _fund(b, 400e6);
        uint256 id3 = _createCircle(2, 1);
        vm.prank(a); sc.join(id3);
        vm.prank(b); sc.join(id3);
        sc.startCycle(id3);
        sc.collect(id3); // pot = 200 = payout
        vm.prank(a); sc.request(id3); // a takes, pot = 0
        // Now b tries; pot=0 but collect inside request might pull more if period 1 is due.
        // We haven't warped so only period 0 is owed and both already paid. b's owedNow = 0.
        // pot = 0 < payout = 200 → PotTooSmall
        vm.prank(b);
        vm.expectRevert(SavingsCircles.PotTooSmall.selector);
        sc.request(id3);
    }

    // =======================================================================
    // Test 3 — Empty wallet: collect records arrears without reverting.
    //          After funding, next collect pulls arrears and counts them as late.
    // =======================================================================
    function test_emptyWalletThenLate() public {
        _fund(alice, 400e6);
        _fund(carol, 400e6);

        // Bob joins with only deposit; no funds left for contributions.
        usdc.mint(bob, 100e6); // exactly deposit
        vm.prank(bob); usdc.approve(address(sc), type(uint256).max);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);
        sc.startCycle(id);

        // Period 0: collect. Bob has 0 balance → skipped. Alice & Carol pay.
        assertEq(usdc.balanceOf(bob), 0);
        sc.collect(id); // must not revert

        assertEq(sc.memberInfo(id, bob).paidThisCycle, 0,    "bob paid nothing");
        assertEq(sc.memberInfo(id, bob).owedNow,       100e6, "bob owes period 0");

        // Fund bob now (after period 0 has passed)
        vm.warp(block.timestamp + PERIOD_LENGTH);
        usdc.mint(bob, 300e6); // fund for all 3 periods
        vm.prank(bob); usdc.approve(address(sc), type(uint256).max);

        // collect again: bob should now pay 2 periods (period 0 late, period 1 on-time).
        sc.collect(id);
        assertEq(sc.memberInfo(id, bob).paidThisCycle, 200e6, "bob paid 2 periods");

        // Reputation: bob should have 1 late payment (period 0) and 1 on-time (period 1).
        (, , uint256 lp, , ) = _rep(bob);
        assertEq(lp, 1, "bob 1 late payment");

        // Balance invariant
        uint256[] memory ids = new uint256[](1); ids[0] = id;
        address[] memory accs = new address[](3); accs[0] = alice; accs[1] = bob; accs[2] = carol;
        _assertBalanceInvariant(ids, accs);
    }

    // =======================================================================
    // Test 4 — Token that reverts transfers for one address: collect still
    //          succeeds for everyone else.
    // =======================================================================
    function test_revertingTokenSkippedInCollect() public {
        RevertingToken rtkn = new RevertingToken();
        SavingsCircles scR  = new SavingsCircles(address(rtkn));

        rtkn.mint(alice, 400e6); vm.prank(alice); rtkn.approve(address(scR), type(uint256).max);
        rtkn.mint(bob,   400e6); vm.prank(bob);   rtkn.approve(address(scR), type(uint256).max);
        rtkn.mint(carol, 400e6); vm.prank(carol); rtkn.approve(address(scR), type(uint256).max);

        uint256 id = scR.createCircle(CONTRIBUTION, PERIOD_LENGTH, 3, 1, new address[](0));
        vm.prank(alice); scR.join(id);
        vm.prank(bob);   scR.join(id);  // bob joins normally (revertFor not set yet)
        vm.prank(carol); scR.join(id);

        // Set bob as the reverting address AFTER all members have joined
        rtkn.setRevertFor(bob);
        scR.startCycle(id);

        // collect() must not revert even though bob's transfer fails
        scR.collect(id); // should not revert

        // Alice and Carol paid; Bob was skipped
        assertEq(scR.memberInfo(id, alice).paidThisCycle, 100e6, "alice paid");
        assertEq(scR.memberInfo(id, bob).paidThisCycle,   0,     "bob skipped (transfer reverts)");
        assertEq(scR.memberInfo(id, carol).paidThisCycle, 100e6, "carol paid");

        // Bob's owed is still non-zero
        assertTrue(scR.memberInfo(id, bob).owedNow > 0, "bob still owes");
    }

    // =======================================================================
    // Test 5 — Allowance too low: member is skipped, others are collected.
    // =======================================================================
    function test_allowanceTooLow() public {
        _fund(alice, 400e6);
        _fund(carol, 400e6);

        // Bob needs unlimited allowance to pay the join deposit, then we reduce it.
        usdc.mint(bob, 400e6);
        vm.prank(bob); usdc.approve(address(sc), type(uint256).max);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);  // join succeeds with unlimited allowance
        vm.prank(carol); sc.join(id);

        // NOW reduce bob's allowance to 50e6 (less than one contribution = 100e6)
        vm.prank(bob); usdc.approve(address(sc), 50e6);

        sc.startCycle(id);

        sc.collect(id);

        assertEq(sc.memberInfo(id, alice).paidThisCycle, 100e6, "alice paid");
        assertEq(sc.memberInfo(id, bob).paidThisCycle,   0,     "bob skipped (allowance too low)");
        assertEq(sc.memberInfo(id, carol).paidThisCycle, 100e6, "carol paid");

        uint256[] memory ids = new uint256[](1); ids[0] = id;
        address[] memory accs = new address[](3); accs[0] = alice; accs[1] = bob; accs[2] = carol;
        _assertBalanceInvariant(ids, accs);
    }

    // =======================================================================
    // Test 6 — depositPeriods = size-1 = 2 (guaranteed pot):
    //          Alice takes in period 0, never pays again.
    //          depositPeriods=2 means deposit=200e6 covers 2 missed periods.
    //          At settlement deposit covers 2 remaining periods → NO default.
    //          Bob and Carol each receive the full payout (300e6).
    //          Alice must topUp before the next cycle.
    // =======================================================================
    function test_depositPeriodsSizeMinusOne_noDefault() public {
        // Alice: deposit(200) + 1 contribution(100) = 300 (enough for deposit + period 0).
        // After taking payout she never pays again; deposit covers periods 1+2.
        _fund(alice, 300e6);
        // Bob and Carol: deposit(200) + 3 contributions(300) = 500 each.
        _fund(bob,   500e6);
        _fund(carol, 500e6);

        uint256 id = _createCircle(3, 2); // depositPeriods=2, deposit=200e6 each
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);
        sc.startCycle(id);

        uint64 cs = sc.getCircle(id).cycleStart;

        // Period 0: all pay, Alice requests payout.
        sc.collect(id);
        assertEq(sc.getCircle(id).pot, 300e6);
        vm.prank(alice); sc.request(id); // pot → 0, alice gets 300e6
        assertEq(sc.claimable(alice), 300e6, "alice claimable");

        // Now Alice has no USDC left (300-200deposit-100contrib = 0).
        assertEq(usdc.balanceOf(alice), 0, "alice has no USDC left");

        // Period 1: collect — Alice has 0 balance, skipped.
        vm.warp(uint256(cs) + PERIOD_LENGTH);
        sc.collect(id);
        assertEq(sc.memberInfo(id, alice).paidThisCycle, 100e6, "alice paid period 0 only");

        // Period 2: collect again.
        vm.warp(uint256(cs) + 2 * PERIOD_LENGTH);
        sc.collect(id);

        // Settle (after grace)
        vm.warp(uint256(cs) + 3 * PERIOD_LENGTH + 1);

        // Before settle: Alice owes 2 periods (periods 1 and 2), deposit=200=2×100 → covered, NO default.
        assertEq(sc.memberInfo(id, alice).owedNow, 200e6, "alice owes 2 periods");
        assertEq(sc.memberInfo(id, alice).deposit,  200e6, "alice deposit = 200");

        sc.settleCycle(id);

        // Alice's deposit was consumed (2 missed periods × 100e6 = 200e6 deducted)
        assertEq(sc.memberInfo(id, alice).deposit, 0,    "alice deposit consumed by settlement");
        // Alice still a member (did NOT default)
        assertTrue(sc.memberInfo(id, alice).isMember, "alice still member (no default)");

        // Alice's reputation: 2 missed payments, 0 defaults.
        (, , , uint256 mp, uint256 df) = _rep(alice);
        assertEq(mp, 2, "alice 2 missed");
        assertEq(df, 0, "alice 0 defaults");

        // Bob and Carol each receive full payout (300e6) — they haven't taken yet.
        // Settle distributed remaining pot to them.
        assertEq(sc.claimable(bob),   300e6, "bob full payout");
        assertEq(sc.claimable(carol), 300e6, "carol full payout");

        // Alice must topUp before next cycle
        vm.prank(alice);
        vm.expectRevert(SavingsCircles.DepositNotFull.selector);
        sc.startCycle(id);

        // Fund and topUp
        usdc.mint(alice, 200e6);
        vm.prank(alice); usdc.approve(address(sc), type(uint256).max);
        vm.prank(alice); sc.topUp(id);
        assertEq(sc.memberInfo(id, alice).deposit, 200e6, "alice deposit restored");

        // Balance invariant
        uint256[] memory ids = new uint256[](1); ids[0] = id;
        address[] memory accs = new address[](3); accs[0] = alice; accs[1] = bob; accs[2] = carol;
        _assertBalanceInvariant(ids, accs);

        // Withdraw claimable
        vm.prank(alice); sc.withdraw();
        vm.prank(bob);   sc.withdraw();
        vm.prank(carol); sc.withdraw();
        // After withdraw: claimables are gone. Deposits remain locked (200 each = 600 total).
        assertEq(usdc.balanceOf(address(sc)), 600e6, "contract holds 3 deposits of 200 each");
    }

    // =======================================================================
    // Test 7 — depositPeriods = 1 (minimal), same take-and-vanish scenario:
    //          Alice takes in period 0, never pays. deposit=100 covers only 1 period.
    //          At settlement Alice defaults (owes 2, deposit covers 1, remainder = 1 missed).
    //          Alice is removed. Bob and Carol each receive 2.5 contributions from the
    //          remaining pot (5 total contributions / 2 non-payout-takers = 2.5 each).
    //          Balance invariant holds throughout.
    // =======================================================================
    function test_depositPeriods1_defaultAndRemoval() public {
        // Alice: deposit(100) + 1 contribution(100) = 200
        _fund(alice, 200e6);
        // Bob and Carol: deposit(100) + 3 contributions(300) = 400 each
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);
        sc.startCycle(id);

        uint64 cs = sc.getCircle(id).cycleStart;

        // Period 0: collect, Alice requests payout.
        sc.collect(id);
        assertEq(sc.getCircle(id).pot, 300e6);
        vm.prank(alice); sc.request(id); // pot → 0
        assertEq(sc.claimable(alice), 300e6);
        assertEq(usdc.balanceOf(alice), 0); // alice has 0 left

        // Periods 1 and 2: collect — Alice skipped each time.
        vm.warp(uint256(cs) + PERIOD_LENGTH);
        sc.collect(id);
        vm.warp(uint256(cs) + 2 * PERIOD_LENGTH);
        sc.collect(id);

        // Settle
        vm.warp(uint256(cs) + 3 * PERIOD_LENGTH + 1);

        // Alice owes 2 periods, deposit=100 covers 1 → 1 period covered, 1 period short → default.
        assertEq(sc.memberInfo(id, alice).owedNow,  200e6);
        assertEq(sc.memberInfo(id, alice).deposit,  100e6);

        sc.settleCycle(id);

        // Alice removed (defaulted)
        assertFalse(sc.memberInfo(id, alice).isMember, "alice removed after default");
        assertEq(sc.getCircle(id).memberCount, 2, "2 members left");

        // Pot at settlement time (before payout to bob/carol):
        // Contributions paid: bob paid 3 × 100 = 300, carol paid 3 × 100 = 300,
        // alice paid 1 × 100 = 100. Alice's deposit deducted 100 (covers 1 missed period).
        // Total in pot at settle = bob(3×100) + carol(3×100) + alice deposit(100) = 700.
        // Alice took 300 already. Remaining pot for settle = 700 - alice's payout(already paid pre-settle pot) ...
        //
        // Let's recalculate:
        // After collect at period 0: pot=300 (alice+bob+carol each 100).
        // Alice requests: pot -= 300 → pot = 0.
        // Period 1 collect: bob+carol each pay 100 → pot = 200.
        // Period 2 collect: bob+carol each pay 100 → pot = 400.
        // At settle: alice owes 200, deposit=100. Deposit covers 100 → pot += 100. One period defaulted.
        // Total pot at settle dispatch = 400 + 100 = 500. Two non-payout-takers (bob, carol).
        // Each gets min(300, 500/2) = min(300, 250) = 250.
        // Last one (carol) gets c.pot which after paying bob = 500-250 = 250.
        assertEq(sc.claimable(bob),   250e6, "bob 250 = 500/2");
        assertEq(sc.claimable(carol), 250e6, "carol 250 = pot remainder");

        // Reputation: alice 1 missed (deposit covered) + 1 default
        (, , , uint256 mp, uint256 df) = _rep(alice);
        assertEq(mp, 2, "alice 2 missed periods"); // deposit covered 1, shortfall the other
        assertEq(df, 1, "alice 1 default");

        // Balance invariant (alice no longer a member but we still track her claimable)
        uint256[] memory ids = new uint256[](1); ids[0] = id;
        address[] memory accs = new address[](3); accs[0] = alice; accs[1] = bob; accs[2] = carol;
        _assertBalanceInvariant(ids, accs);

        // Withdraw
        vm.prank(alice); sc.withdraw(); // 300e6 claimable from payout
        vm.prank(bob);   sc.withdraw();
        vm.prank(carol); sc.withdraw();

        // Contract should hold only bob and carol's deposits (100e6 each = 200e6 total)
        assertEq(usdc.balanceOf(address(sc)), 200e6, "only deposits remain");
    }

    // =======================================================================
    // Test 8 — settleCycle before allowed time reverts TooEarlyToSettle.
    // =======================================================================
    function test_settleTooEarly() public {
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);
        sc.startCycle(id);

        uint64 cs = sc.getCircle(id).cycleStart;

        // Just before the settle window: size * periodLength - 1 second
        vm.warp(uint256(cs) + 3 * PERIOD_LENGTH - 1);
        vm.expectRevert(SavingsCircles.TooEarlyToSettle.selector);
        sc.settleCycle(id);

        // Exactly at the settle time → should succeed
        vm.warp(uint256(cs) + 3 * PERIOD_LENGTH);
        sc.settleCycle(id); // no revert
        assertEq(uint8(sc.getCircle(id).state), uint8(SavingsCircles.CircleState.Pending));
    }

    // =======================================================================
    // Test 9 — Second cycle: member leaves, new member joins, another topUp,
    //          startCycle works, cycle2 runs, cyclesCompleted increments.
    // =======================================================================
    function test_secondCycle() public {
        // Cycle 1: deposit(100) + 3 contributions(300) = 400 per member.
        // Cycle 2: 3 more contributions(300). Total = 700 per member.
        // Dave only does cycle 2: deposit(100) + 3 contributions(300) = 400.
        _fund(alice, 700e6);
        _fund(bob,   700e6);
        _fund(carol, 700e6);
        _fund(dave,  400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);
        sc.startCycle(id);

        // Run cycle 1: all pay, alice requests, settle.
        uint64 cs1 = sc.getCircle(id).cycleStart;
        sc.collect(id);
        vm.prank(alice); sc.request(id);
        // Bob and Carol need to take payout too or they'll be paid at settle.
        vm.warp(uint256(cs1) + PERIOD_LENGTH);
        sc.collect(id);
        vm.prank(bob); sc.request(id);
        vm.warp(uint256(cs1) + 2 * PERIOD_LENGTH);
        sc.collect(id);
        vm.prank(carol); sc.request(id);
        vm.warp(uint256(cs1) + 3 * PERIOD_LENGTH + 1);
        sc.settleCycle(id);

        // Now Pending. Bob leaves, Dave joins.
        vm.prank(bob); sc.leave(id);
        assertEq(sc.claimable(bob), 300e6 + 100e6, "bob claimable = payout + deposit");
        assertEq(sc.getCircle(id).memberCount, 2, "2 members after bob leaves");

        vm.prank(dave); usdc.approve(address(sc), type(uint256).max);
        vm.prank(dave); sc.join(id);
        assertEq(sc.getCircle(id).memberCount, 3, "3 members after dave joins");

        // Deposits: alice and carol still have full deposit (not deducted in cycle1).
        assertEq(sc.memberInfo(id, alice).deposit, 100e6, "alice deposit full");
        assertEq(sc.memberInfo(id, carol).deposit, 100e6, "carol deposit full");
        assertEq(sc.memberInfo(id, dave).deposit,  100e6, "dave deposit full");

        // startCycle should work (all full)
        sc.startCycle(id);
        SavingsCircles.CircleView memory v = sc.getCircle(id);
        assertEq(uint8(v.state), uint8(SavingsCircles.CircleState.Active));
        assertEq(v.cycle, 2, "cycle counter = 2");

        // Run cycle 2: all pay, all request, settle.
        uint64 cs2 = v.cycleStart;
        sc.collect(id);
        vm.prank(alice); sc.request(id);
        vm.warp(uint256(cs2) + PERIOD_LENGTH);
        sc.collect(id);
        vm.prank(carol); sc.request(id);
        vm.warp(uint256(cs2) + 2 * PERIOD_LENGTH);
        sc.collect(id);
        vm.prank(dave); sc.request(id);
        vm.warp(uint256(cs2) + 3 * PERIOD_LENGTH + 1);
        sc.settleCycle(id);

        // cyclesCompleted: alice=2, carol=2, dave=1, bob=1 (left after cycle1)
        (uint256 cc_a, , , , ) = _rep(alice);
        (uint256 cc_c, , , , ) = _rep(carol);
        (uint256 cc_d, , , , ) = _rep(dave);
        (uint256 cc_b, , , , ) = _rep(bob);
        assertEq(cc_a, 2, "alice 2 cycles");
        assertEq(cc_c, 2, "carol 2 cycles");
        assertEq(cc_d, 1, "dave 1 cycle");
        assertEq(cc_b, 1, "bob 1 cycle (left after)");
    }

    // =======================================================================
    // Test 10a — startCycle: NotEnoughMembers revert, join/leave while Active.
    // =======================================================================
    function test_startCycleNotEnoughAndActiveReverts() public {
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);
        _fund(dave,  400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);

        // NotEnoughMembers (2 of 3 joined)
        vm.expectRevert(SavingsCircles.NotEnoughMembers.selector);
        sc.startCycle(id);

        // Fill and start
        vm.prank(carol); sc.join(id);
        sc.startCycle(id); // Active

        // join while Active → InvalidState
        vm.prank(dave);
        vm.expectRevert(SavingsCircles.InvalidState.selector);
        sc.join(id);

        // leave while Active → InvalidState
        vm.prank(alice);
        vm.expectRevert(SavingsCircles.InvalidState.selector);
        sc.leave(id);
    }

    // =======================================================================
    // Test 10b — DepositNotFull blocks startCycle; topUp restores it.
    // Setup: size=3, depositPeriods=2 (deposit=200). fa misses 2 periods (pays
    // only period 2). Settlement deducts 2×100=200 from deposit → deposit=0.
    // startCycle reverts DepositNotFull. topUp restores fa's deposit.
    // startCycle then succeeds.
    // =======================================================================
    function test_depositNotFull() public {
        // Setup: size=3, depositPeriods=2, deposit=200 per member.
        // fa gets exactly deposit (200) — 0 balance after joining.
        // fb and fc get deposit + 3 contributions (800 each).
        address fa = makeAddr("fa");
        address fb = makeAddr("fb");
        address fc = makeAddr("fc");
        usdc.mint(fa, 200e6); vm.prank(fa); usdc.approve(address(sc), type(uint256).max);
        usdc.mint(fb, 800e6); vm.prank(fb); usdc.approve(address(sc), type(uint256).max);
        usdc.mint(fc, 800e6); vm.prank(fc); usdc.approve(address(sc), type(uint256).max);

        // size=3, depositPeriods=2 → full deposit = 200e6
        uint256 id = sc.createCircle(CONTRIBUTION, PERIOD_LENGTH, 3, 2, new address[](0));
        vm.prank(fa); sc.join(id); // deposit=200, fa now has 0 balance
        vm.prank(fb); sc.join(id);
        vm.prank(fc); sc.join(id);
        sc.startCycle(id);
        uint64 cs = sc.getCircle(id).cycleStart;

        // fa has 0 USDC, misses all 3 periods.
        // At period 2: fund fa with 100e6 and let fa pay just period 2.
        vm.warp(uint256(cs) + 2 * PERIOD_LENGTH);
        usdc.mint(fa, 100e6);
        vm.prank(fa); sc.pay(id); // pays period 2 only; paidThisCycle=100

        // fb and fc pay everything via collect at settle time (late but covered)
        vm.warp(uint256(cs) + 3 * PERIOD_LENGTH + 1);
        sc.collect(id); // fb+fc pay 3 periods each (late); fa has 0 balance, skipped
        vm.prank(fb); sc.request(id);
        vm.prank(fc); sc.request(id);

        // At settle: fa owedNow = 3*100 - 100 = 200; deposit=200 → covers exactly → no default.
        sc.settleCycle(id);

        // fa still member, deposit consumed to 0
        assertTrue(sc.memberInfo(id, fa).isMember, "fa still member");
        assertEq(sc.memberInfo(id, fa).deposit, 0, "fa deposit = 0");

        // startCycle → DepositNotFull
        vm.expectRevert(SavingsCircles.DepositNotFull.selector);
        sc.startCycle(id);

        // topUp restores fa's deposit → startCycle succeeds
        usdc.mint(fa, 200e6);
        vm.prank(fa); sc.topUp(id);
        assertEq(sc.memberInfo(id, fa).deposit, 200e6, "fa deposit restored");

        sc.startCycle(id); // no revert — all deposits full
        assertEq(uint8(sc.getCircle(id).state), uint8(SavingsCircles.CircleState.Active));
    }

    // =======================================================================
    // Test 11 — Invite list: uninvited join reverts, invited works.
    // =======================================================================
    function test_inviteList() public {
        address[] memory inviteList = new address[](3);
        inviteList[0] = alice;
        inviteList[1] = bob;
        inviteList[2] = carol;

        uint256 id = sc.createCircle(CONTRIBUTION, PERIOD_LENGTH, 3, 1, inviteList);

        assertTrue(sc.isInvited(id, alice), "alice invited");
        assertTrue(sc.isInvited(id, bob),   "bob invited");
        assertTrue(sc.isInvited(id, carol), "carol invited");
        assertFalse(sc.isInvited(id, dave), "dave not invited");

        _fund(dave, 400e6);
        vm.prank(dave);
        vm.expectRevert(SavingsCircles.NotInvited.selector);
        sc.join(id);

        // InviteListTooShort
        address[] memory shortList = new address[](2);
        shortList[0] = alice;
        shortList[1] = bob;
        vm.expectRevert(SavingsCircles.InviteListTooShort.selector);
        sc.createCircle(CONTRIBUTION, PERIOD_LENGTH, 3, 1, shortList);

        // Invited members can join and run a full cycle
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);

        sc.startCycle(id);
        assertEq(uint8(sc.getCircle(id).state), uint8(SavingsCircles.CircleState.Active));

        sc.collect(id);
        vm.prank(alice); sc.request(id);

        uint64 cs = sc.getCircle(id).cycleStart;
        vm.warp(uint256(cs) + PERIOD_LENGTH);
        sc.collect(id);
        vm.prank(bob); sc.request(id);

        vm.warp(uint256(cs) + 2 * PERIOD_LENGTH);
        sc.collect(id);
        vm.prank(carol); sc.request(id);

        vm.warp(uint256(cs) + 3 * PERIOD_LENGTH + 1);
        sc.settleCycle(id);

        vm.prank(alice); sc.withdraw();
        vm.prank(bob);   sc.withdraw();
        vm.prank(carol); sc.withdraw();
        assertEq(usdc.balanceOf(address(sc)), 300e6, "only deposits remain"); // 3 × 100e6 deposits
    }

    // =======================================================================
    // Test 12 — withdraw: exact amount, second call reverts, reentrant token.
    // =======================================================================
    function test_withdraw() public {
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);
        sc.startCycle(id);

        sc.collect(id);
        vm.prank(alice); sc.request(id);
        assertEq(sc.claimable(alice), 300e6);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice); sc.withdraw();
        assertEq(usdc.balanceOf(alice), balBefore + 300e6, "exact withdrawal");
        assertEq(sc.claimable(alice), 0, "claimable zeroed");

        vm.prank(alice);
        vm.expectRevert(SavingsCircles.NothingToWithdraw.selector);
        sc.withdraw();
    }

    function test_withdrawReentrancy() public {
        ReentrantToken rtkn = new ReentrantToken();
        SavingsCircles scR  = new SavingsCircles(address(rtkn));
        rtkn.setSC(address(scR));

        rtkn.mint(alice, 400e6); vm.prank(alice); rtkn.approve(address(scR), type(uint256).max);
        rtkn.mint(bob,   400e6); vm.prank(bob);   rtkn.approve(address(scR), type(uint256).max);
        rtkn.mint(carol, 400e6); vm.prank(carol); rtkn.approve(address(scR), type(uint256).max);

        uint256 id = scR.createCircle(CONTRIBUTION, PERIOD_LENGTH, 3, 1, new address[](0));
        vm.prank(alice); scR.join(id);
        vm.prank(bob);   scR.join(id);
        vm.prank(carol); scR.join(id);
        scR.startCycle(id);

        scR.collect(id);
        vm.prank(alice); scR.request(id);
        assertEq(scR.claimable(alice), 300e6);

        uint256 balBefore = rtkn.balanceOf(alice);
        vm.prank(alice); scR.withdraw(); // inner re-entry is caught silently
        assertEq(rtkn.balanceOf(alice), balBefore + 300e6, "no double withdrawal");
        assertEq(scR.claimable(alice), 0, "claimable zero after reentrancy");
    }

    // =======================================================================
    // Test 13a — Fuzz: createCircle accepts any valid params without reverting.
    // =======================================================================
    function testFuzz_createCircleParams(
        uint256 contribution,
        uint64  periodLength,
        uint8   size,
        uint8   depositPeriods
    ) public {
        contribution  = bound(contribution,  1, 1e30);
        periodLength  = uint64(bound(uint256(periodLength), 1, 365 days));
        size          = uint8(bound(uint256(size), 2, 20));
        depositPeriods = uint8(bound(uint256(depositPeriods), 1, uint256(size) - 1));

        uint256 id = sc.createCircle(contribution, periodLength, size, depositPeriods, new address[](0));

        SavingsCircles.CircleView memory v = sc.getCircle(id);
        assertEq(v.contribution,   contribution,   "contribution stored");
        assertEq(v.periodLength,   periodLength,   "periodLength stored");
        assertEq(v.size,           size,           "size stored");
        assertEq(v.depositPeriods, depositPeriods, "depositPeriods stored");
        assertEq(v.payout,         uint256(size) * contribution, "payout = size * contribution");
        assertEq(uint8(v.state),   uint8(SavingsCircles.CircleState.Pending), "Pending");
    }

    // =======================================================================
    // Test 13b — Fuzz: random pay/miss patterns assert balance invariant.
    //            Runs a single cycle with 3 members. For each period, a random
    //            bitmask determines who pays (via pay()) and who doesn't.
    //            After settle, asserts balance invariant.
    // =======================================================================
    function testFuzz_balanceInvariant(uint8 payMask0, uint8 payMask1, uint8 payMask2) public {
        // Each payMask bit: bit0=alice, bit1=bob, bit2=carol pays that period.
        // Members are funded with enough to pay all 3 periods if they want.
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);
        sc.startCycle(id);

        address[3] memory members = [alice, bob, carol];
        uint8[3] memory masks = [payMask0, payMask1, payMask2];
        uint64 cs = sc.getCircle(id).cycleStart;

        for (uint256 p; p < 3; ++p) {
            vm.warp(uint256(cs) + p * PERIOD_LENGTH + 1);
            for (uint256 m; m < 3; ++m) {
                if (masks[p] & (uint8(1) << uint8(m)) != 0) {
                    vm.prank(members[m]);
                    sc.pay(id);
                }
            }
        }

        // Any member who is not in arrears and pot >= payout can request.
        // We try for each member; ignore failures.
        for (uint256 m; m < 3; ++m) {
            if (sc.memberInfo(id, members[m]).owedNow == 0 &&
                sc.getCircle(id).pot >= sc.getCircle(id).payout &&
                !sc.memberInfo(id, members[m]).takenThisCycle)
            {
                vm.prank(members[m]);
                try sc.request(id) {} catch {}
            }
        }

        // Settle
        vm.warp(uint256(cs) + 3 * PERIOD_LENGTH + 1);
        sc.settleCycle(id);

        // Balance invariant: contract USDC == all pots + all deposits + all claimable
        uint256[] memory ids = new uint256[](1); ids[0] = id;
        address[] memory accs = new address[](3); accs[0] = alice; accs[1] = bob; accs[2] = carol;
        _assertBalanceInvariant(ids, accs);
    }
}
