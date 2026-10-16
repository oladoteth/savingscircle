// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SavingsCircles} from "../SavingsCircles.sol";

// ---------------------------------------------------------------------------
// Mock ERC-20 (normal — used for most tests)
// ---------------------------------------------------------------------------
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

// ---------------------------------------------------------------------------
// Reentrant ERC-20 (Test 5 reentrancy guard)
// Calls sc.withdraw() from inside transfer(), guarded by a flag.
// ---------------------------------------------------------------------------
contract ReentrantToken is ERC20 {
    SavingsCircles public sc;
    bool public attacking;

    constructor() ERC20("Reentrant", "RTKN") {}

    function setSC(address sc_) external {
        sc = SavingsCircles(sc_);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // Override transfer so that on the first outgoing transfer (i.e. the one
    // from withdraw()), we try to re-enter withdraw().
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (!attacking) {
            attacking = true;
            // Attempt re-entry — must revert with ReentrancyGuardReentrantCall
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
    MockUSDC internal usdc;
    SavingsCircles internal sc;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");

    uint256 internal constant CONTRIBUTION = 100e6; // 100 USDC
    uint64 internal constant ROUND_LENGTH = 1 days;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Fund an address with `amount` USDC and give the SavingsCircles contract
    /// an unlimited allowance.
    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(sc), type(uint256).max);
    }

    /// Create a circle with CONTRIBUTION / ROUND_LENGTH and return its id.
    function _createCircle(uint8 size, uint8 depositRounds) internal returns (uint256 id) {
        id = sc.createCircle(CONTRIBUTION, ROUND_LENGTH, size, depositRounds);
    }

    /// Advance block.timestamp past the current round deadline and close the round.
    function _advanceAndClose(uint256 id) internal {
        (, , , , , uint64 deadline, , , ) = sc.getCircle(id);
        vm.warp(deadline + 1);
        sc.closeRound(id);
    }

    // -----------------------------------------------------------------------
    // setUp — runs before every test function
    // -----------------------------------------------------------------------
    function setUp() public {
        usdc = new MockUSDC();
        sc = new SavingsCircles(address(usdc));
    }

    // =======================================================================
    // Test 1 — Happy path: 3-member circle, depositRounds=1, everyone pays
    // =======================================================================
    function test_happyPath() public {
        // Each member needs:
        //   deposit:          1 × 100e6 = 100e6
        //   contributions:    3 × 100e6 = 300e6
        //   total minted:                400e6
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        // Join order determines recipient order: alice[0] bob[1] carol[2]
        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id); // last join → Active

        // Deposits = contribution * depositRounds = 100e6 * 1
        assertEq(sc.depositOf(id, alice), 100e6);
        assertEq(sc.depositOf(id, bob),   100e6);
        assertEq(sc.depositOf(id, carol), 100e6);

        // Circle is Active
        (, , , , , , SavingsCircles.CircleState state, , ) = sc.getCircle(id);
        assertEq(uint8(state), uint8(SavingsCircles.CircleState.Active));

        // ---- Round 0: recipient = alice ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);

        _advanceAndClose(id);

        assertEq(sc.claimable(alice), 300e6, "alice claimable round 0");
        vm.prank(alice); sc.withdraw();
        // alice spent: 100(deposit) + 100(r0 contrib) = 200, received 300 pot → net +100 above start of 400
        assertEq(usdc.balanceOf(alice), 400e6 - 200e6 + 300e6, "alice balance after round 0 withdraw");

        // ---- Round 1: recipient = bob ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);

        _advanceAndClose(id);

        assertEq(sc.claimable(bob), 300e6, "bob claimable round 1");
        vm.prank(bob); sc.withdraw();

        // ---- Round 2: recipient = carol ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);

        // Expect CircleFinished on last closeRound
        (, , , , , uint64 dl2, , , ) = sc.getCircle(id);
        vm.warp(dl2 + 1);
        vm.expectEmit(true, false, false, false, address(sc));
        emit SavingsCircles.CircleFinished(id);
        sc.closeRound(id);

        // Carol's round-2 pot + her deposit returned in one claimable
        assertEq(sc.claimable(carol), 300e6 + 100e6, "carol claimable = pot + deposit");
        // Deposits returned to alice and bob
        assertEq(sc.claimable(alice), 100e6, "alice deposit returned");
        assertEq(sc.claimable(bob),   100e6, "bob deposit returned");

        // Circle is Finished
        (, , , , , , SavingsCircles.CircleState stateEnd, , ) = sc.getCircle(id);
        assertEq(uint8(stateEnd), uint8(SavingsCircles.CircleState.Finished));

        // Withdraw all remaining claimable
        vm.prank(carol); sc.withdraw();
        vm.prank(alice); sc.withdraw();
        vm.prank(bob);   sc.withdraw();

        // Contract USDC balance must be exactly zero
        assertEq(usdc.balanceOf(address(sc)), 0, "contract balance = 0");

        // Every member minted 400e6 and spent 400e6 (deposit + 3 contribs)
        // Alice received: 300e6 (r0 pot) + 100e6 (deposit back) = 400e6
        // Bob  received: 300e6 (r1 pot) + 100e6 (deposit back) = 400e6
        // Carol received: 300e6 (r2 pot) + 100e6 (deposit back) = 400e6
        assertEq(usdc.balanceOf(alice), 400e6, "alice net zero");
        assertEq(usdc.balanceOf(bob),   400e6, "bob net zero");
        assertEq(usdc.balanceOf(carol), 400e6, "carol net zero");

        // Reputation: all completed, 3 on-time payments, 0 missed/defaults
        _assertRep(alice, 1, 3, 0, 0);
        _assertRep(bob,   1, 3, 0, 0);
        _assertRep(carol, 1, 3, 0, 0);
    }

    // =======================================================================
    // Test 2 — One missed payment by non-recipient: deposit covers it
    // Bob misses round 0 (not recipient). Deposit 100e6 covers the miss.
    // =======================================================================
    function test_missedNonRecipientDepositCovers() public {
        // Bob misses round 0 contribution → his deposit covers it → deposit → 0
        // Bob's needed USDC: deposit=100e6, rounds 1+2=200e6 → 300e6 total
        _fund(alice, 400e6);
        _fund(bob,   300e6);
        _fund(carol, 400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id); // member[0], recipient round 0
        vm.prank(bob);   sc.join(id); // member[1], recipient round 1
        vm.prank(carol); sc.join(id); // member[2], recipient round 2

        // ---- Round 0: alice is recipient. Bob does NOT contribute. ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(carol); sc.contribute(id);
        // Bob skips → deposit covers his miss

        (, , , , , uint64 dl0, , , ) = sc.getCircle(id);
        vm.warp(dl0 + 1);

        // Expect Missed(bob) — deposit >= contribution
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Missed(id, bob, 0);
        // pot = alice(100) + carol(100) + bob's deposit(100) = 300e6
        vm.expectEmit(true, false, true, true, address(sc));
        emit SavingsCircles.RoundClosed(id, 0, alice, 300e6);
        sc.closeRound(id);

        assertEq(sc.claimable(alice), 300e6, "alice gets full pot");
        assertEq(sc.depositOf(id, bob), 0,   "bob deposit consumed");

        vm.prank(alice); sc.withdraw();

        // ---- Round 1: bob is recipient. All contribute. ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);

        _advanceAndClose(id);
        assertEq(sc.claimable(bob), 300e6, "bob claimable round 1");
        vm.prank(bob); sc.withdraw();

        // ---- Round 2: carol is recipient. All contribute. ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);

        _advanceAndClose(id); // last round → CircleFinished

        // carol pot + carol deposit
        assertEq(sc.claimable(carol), 300e6 + 100e6, "carol pot + deposit");
        // alice deposit back
        assertEq(sc.claimable(alice), 100e6, "alice deposit returned");
        // bob deposit already consumed → 0
        assertEq(sc.claimable(bob), 0, "bob no deposit returned");

        vm.prank(carol); sc.withdraw();
        vm.prank(alice); sc.withdraw();
        // bob has 0 claimable — no withdraw

        assertEq(usdc.balanceOf(address(sc)), 0, "contract balance = 0");

        // Bob: missedPayments=1, completedCircles=1 (no default), onTimePayments=2
        _assertRep(bob,   1, 2, 1, 0);
        _assertRep(alice, 1, 3, 0, 0);
        _assertRep(carol, 1, 3, 0, 0);
    }

    // =======================================================================
    // Test 3 — Two missed payments by same non-recipient → second causes default
    // Carol misses round 0 (deposit covers, Missed) then round 1 (deposit=0, Defaulted).
    // =======================================================================
    function test_doubleDefaultCausesShortPot() public {
        // Carol needs: deposit(100e6) + only round 2 contribution(100e6) = 200e6
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 200e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id); // member[0], recipient round 0
        vm.prank(bob);   sc.join(id); // member[1], recipient round 1
        vm.prank(carol); sc.join(id); // member[2], recipient round 2

        // ---- Round 0: alice recipient. Carol misses (not recipient). ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        // Carol skips

        (, , , , , uint64 dl0, , , ) = sc.getCircle(id);
        vm.warp(dl0 + 1);

        // Carol has deposit 100e6 >= 100e6 → Missed (not Defaulted)
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Missed(id, carol, 0);
        // pot = alice(100) + bob(100) + carol's deposit(100) = 300e6
        vm.expectEmit(true, false, true, true, address(sc));
        emit SavingsCircles.RoundClosed(id, 0, alice, 300e6);
        sc.closeRound(id);

        // claimable[alice] = 300e6 (not yet withdrawn in this test)
        assertEq(sc.claimable(alice), 300e6, "alice round-0 pot");
        assertEq(sc.depositOf(id, carol), 0, "carol deposit consumed");

        // ---- Round 1: bob recipient. Carol misses again (deposit=0 → DEFAULT). ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        // Carol skips — deposit=0 < 100e6 → Defaulted

        (, , , , , uint64 dl1, , , ) = sc.getCircle(id);
        vm.warp(dl1 + 1);

        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Defaulted(id, carol, 1);
        // pot = alice(100) + bob(100) + carol(0) = 200e6
        vm.expectEmit(true, false, true, true, address(sc));
        emit SavingsCircles.RoundClosed(id, 1, bob, 200e6);
        sc.closeRound(id);

        assertEq(sc.claimable(bob), 200e6, "bob short pot round 1");

        // ---- Round 2: carol recipient. All pay. ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);

        _advanceAndClose(id); // last round, circle finishes

        // carol gets full pot round 2 = 300e6
        assertEq(sc.claimable(carol), 300e6, "carol round-2 pot");
        // Deposits returned: alice=100e6, bob=100e6, carol=0 (all consumed)
        // claimable[alice] = 300e6 (r0 pot, never withdrawn) + 100e6 (deposit back) = 400e6
        assertEq(sc.claimable(alice), 300e6 + 100e6, "alice claimable = r0 pot + deposit");
        assertEq(sc.claimable(bob),   200e6 + 100e6, "bob claimable = r1 pot + deposit");
        assertEq(sc.claimable(carol), 300e6,          "carol claimable = r2 pot, no deposit");

        // Withdraw all
        vm.prank(alice); sc.withdraw();
        vm.prank(bob);   sc.withdraw();
        vm.prank(carol); sc.withdraw();

        assertEq(usdc.balanceOf(address(sc)), 0, "contract balance = 0");

        // Carol: missedPayments=2, defaults=1, completedCircles=0, onTimePayments=1
        _assertRep(carol, 0, 1, 2, 1);
        // Bob: missedPayments=0, got short pot but that's not a reputation event
        _assertRep(bob,   1, 3, 0, 0);
        _assertRep(alice, 1, 3, 0, 0);
    }

    // =======================================================================
    // Test 4 — Revert cases
    // =======================================================================
    function test_reverts() public {
        _fund(alice, 1000e6);
        _fund(bob,   1000e6);
        _fund(carol, 1000e6);

        uint256 id = _createCircle(3, 1);

        // ---- join twice → AlreadyMember ----
        vm.prank(alice); sc.join(id);
        vm.prank(alice);
        vm.expectRevert(SavingsCircles.AlreadyMember.selector);
        sc.join(id);

        // Fill the circle
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id); // Active now

        // ---- join when Active (state guard fires first) → InvalidState ----
        address extra = makeAddr("extra");
        usdc.mint(extra, 1000e6);
        vm.prank(extra);
        usdc.approve(address(sc), type(uint256).max);
        vm.prank(extra);
        vm.expectRevert(SavingsCircles.InvalidState.selector);
        sc.join(id);

        // ---- CircleFull test: fill a size=2 circle but a 3rd tries before state change ---
        // Actually size=2: after alice joins (1/2) and bob joins (2/2) it transitions to Active,
        // so InvalidState fires before CircleFull. Create a size=3 circle and add only 2 members,
        // then try to have the same already-member join again → AlreadyMember.
        // To hit CircleFull purely: we need memberCount == size while still Pending.
        // That's impossible since last join triggers Active. So CircleFull is only reachable
        // when Pending and already full — which can't happen by design (transitions to Active).
        // Skip CircleFull direct test; it's always shadowed by InvalidState in this contract.

        // ---- contribute twice → AlreadyPaid ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(alice);
        vm.expectRevert(SavingsCircles.AlreadyPaid.selector);
        sc.contribute(id);

        // ---- contribute after deadline → RoundClosedAlready ----
        (, , , , , uint64 dl, , , ) = sc.getCircle(id);
        vm.warp(dl + 1);
        vm.prank(bob);
        vm.expectRevert(SavingsCircles.RoundClosedAlready.selector);
        sc.contribute(id);

        // ---- contribute by non-member → NotMember ----
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(SavingsCircles.NotMember.selector);
        sc.contribute(id);

        // ---- closeRound before deadline → RoundStillOpen ----
        _fund(alice, 300e6);
        _fund(bob,   300e6);
        _fund(carol, 300e6);
        uint256 id4 = _createCircle(3, 1);
        vm.prank(alice); sc.join(id4);
        vm.prank(bob);   sc.join(id4);
        vm.prank(carol); sc.join(id4); // Active
        vm.expectRevert(SavingsCircles.RoundStillOpen.selector);
        sc.closeRound(id4);

        // ---- closeRound on finished circle → InvalidState ----
        // Run id4 to completion (3 rounds, no one pays → deadline pass each time)
        (, , , , , uint64 d4a, , , ) = sc.getCircle(id4);
        vm.warp(d4a + 1); sc.closeRound(id4);
        (, , , , , uint64 d4b, , , ) = sc.getCircle(id4);
        vm.warp(d4b + 1); sc.closeRound(id4);
        (, , , , , uint64 d4c, , , ) = sc.getCircle(id4);
        vm.warp(d4c + 1); sc.closeRound(id4);
        (, , , , , , SavingsCircles.CircleState fin, , ) = sc.getCircle(id4);
        assertEq(uint8(fin), uint8(SavingsCircles.CircleState.Finished));
        vm.expectRevert(SavingsCircles.InvalidState.selector);
        sc.closeRound(id4);

        // ---- createCircle with depositRounds=0 → InvalidDepositRounds ----
        vm.expectRevert(SavingsCircles.InvalidDepositRounds.selector);
        sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 3, 0);

        // ---- createCircle with depositRounds=size → InvalidDepositRounds ----
        vm.expectRevert(SavingsCircles.InvalidDepositRounds.selector);
        sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 3, 3);
    }

    // =======================================================================
    // Test 5 — Withdraw: correct amount, double-withdraw reverts, reentrancy
    // =======================================================================
    function test_withdraw() public {
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);

        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);

        _advanceAndClose(id);

        // Alice is round-0 recipient: claimable = 300e6
        assertEq(sc.claimable(alice), 300e6);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice); sc.withdraw();
        assertEq(usdc.balanceOf(alice), balBefore + 300e6, "exact withdrawal amount");
        assertEq(sc.claimable(alice), 0, "claimable zeroed");

        // Second withdraw → NothingToWithdraw
        vm.prank(alice);
        vm.expectRevert(SavingsCircles.NothingToWithdraw.selector);
        sc.withdraw();
    }

    function test_withdrawReentrancy() public {
        // Deploy SavingsCircles with the reentrant token
        ReentrantToken rtkn = new ReentrantToken();
        SavingsCircles scR = new SavingsCircles(address(rtkn));
        rtkn.setSC(address(scR));

        rtkn.mint(alice, 400e6);
        vm.prank(alice); rtkn.approve(address(scR), type(uint256).max);
        rtkn.mint(bob, 400e6);
        vm.prank(bob);   rtkn.approve(address(scR), type(uint256).max);
        rtkn.mint(carol, 400e6);
        vm.prank(carol); rtkn.approve(address(scR), type(uint256).max);

        uint256 id = scR.createCircle(CONTRIBUTION, ROUND_LENGTH, 3, 1);
        vm.prank(alice); scR.join(id);
        vm.prank(bob);   scR.join(id);
        vm.prank(carol); scR.join(id);

        vm.prank(alice); scR.contribute(id);
        vm.prank(bob);   scR.contribute(id);
        vm.prank(carol); scR.contribute(id);

        (, , , , , uint64 dl, , , ) = scR.getCircle(id);
        vm.warp(dl + 1);
        scR.closeRound(id);

        // alice has claimable = 300e6
        assertEq(scR.claimable(alice), 300e6);

        uint256 balBefore = rtkn.balanceOf(alice);

        // alice withdraws — token's transfer() tries to re-enter withdraw()
        // The reentrancy guard must block the inner call
        vm.prank(alice);
        scR.withdraw(); // outer call succeeds; inner attempt is caught (silently) in ReentrantToken

        // Alice received exactly 300e6, not double
        assertEq(rtkn.balanceOf(alice), balBefore + 300e6, "no double withdrawal");
        assertEq(scR.claimable(alice), 0, "claimable = 0 after reentrancy attempt");
    }

    // =======================================================================
    // Test 6 — Reputation counters after a mixed circle
    // Alice: pays all 3 → onTime=3, missed=0, default=0, completed=1
    // Bob:   misses r0 (deposit covers), pays r1+r2 → onTime=2, missed=1, default=0, completed=1
    // Carol: misses r0 (deposit covers), misses r1 (deposit=0 → default), pays r2 → onTime=1, missed=2, default=1, completed=0
    // =======================================================================
    function test_reputationCounters() public {
        _fund(alice, 400e6);
        _fund(bob,   300e6); // deposit(100) + rounds 1+2 (200)
        _fund(carol, 200e6); // deposit(100) + only round 2 (100)

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id); // member[0], recipient round 0
        vm.prank(bob);   sc.join(id); // member[1], recipient round 1
        vm.prank(carol); sc.join(id); // member[2], recipient round 2

        // ---- Round 0: alice recipient. Bob & Carol miss. ----
        vm.prank(alice); sc.contribute(id);
        // Bob & Carol do NOT contribute

        (, , , , , uint64 dl0, , , ) = sc.getCircle(id);
        vm.warp(dl0 + 1);
        sc.closeRound(id);
        // Bob: deposit 100e6 → Missed, deposit → 0
        // Carol: deposit 100e6 → Missed, deposit → 0
        // pot = alice(100) + bob_dep(100) + carol_dep(100) = 300e6

        assertEq(sc.claimable(alice), 300e6);
        assertEq(sc.depositOf(id, bob),   0);
        assertEq(sc.depositOf(id, carol), 0);

        // ---- Round 1: bob recipient. Carol misses again (deposit=0 → default). ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        // Carol does NOT contribute

        (, , , , , uint64 dl1, , , ) = sc.getCircle(id);
        vm.warp(dl1 + 1);
        sc.closeRound(id);
        // carol: deposit=0 < 100e6 → Defaulted
        // pot = alice(100) + bob(100) + carol(0) = 200e6

        assertEq(sc.claimable(bob), 200e6, "bob short pot");

        // ---- Round 2: carol recipient. All pay. ----
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);

        _advanceAndClose(id); // last round

        // carol gets round-2 pot = 300e6
        assertEq(sc.claimable(carol), 300e6);
        // Deposit returns at finish: alice=100, bob=0, carol=0
        // claimable[alice] = 300(r0 pot, never withdrawn) + 100(deposit) = 400
        assertEq(sc.claimable(alice), 300e6 + 100e6, "alice total claimable");
        assertEq(sc.claimable(bob),   200e6 + 0,      "bob = r1 pot, no deposit");
        assertEq(sc.claimable(carol), 300e6,           "carol = r2 pot, no deposit");

        // Withdraw all
        vm.prank(alice); sc.withdraw();
        vm.prank(bob);   sc.withdraw();
        vm.prank(carol); sc.withdraw();

        assertEq(usdc.balanceOf(address(sc)), 0, "contract balance = 0");

        // Exact reputation assertions
        _assertRep(alice, 1, 3, 0, 0);
        _assertRep(bob,   1, 2, 1, 0);
        _assertRep(carol, 0, 1, 2, 1);
    }

    // =======================================================================
    // Test 7 — Two circles running concurrently do not affect each other
    // Circle A: alice+bob, size=2, contribution=100e6
    // Circle B: carol+dave, size=2, contribution=200e6
    // =======================================================================
    function test_twoConcurrentCircles() public {
        // Each needs: deposit + 2 round contributions
        _fund(alice, 100e6 + 2 * 100e6); // 300e6
        _fund(bob,   100e6 + 2 * 100e6); // 300e6
        _fund(carol, 200e6 + 2 * 200e6); // 600e6
        _fund(dave,  200e6 + 2 * 200e6); // 600e6

        // Circle A
        uint256 idA = sc.createCircle(100e6, ROUND_LENGTH, 2, 1);
        vm.prank(alice); sc.join(idA); // member[0], recipient round 0
        vm.prank(bob);   sc.join(idA); // member[1], recipient round 1

        // Circle B
        uint256 idB = sc.createCircle(200e6, ROUND_LENGTH, 2, 1);
        vm.prank(carol); sc.join(idB); // member[0], recipient round 0
        vm.prank(dave);  sc.join(idB); // member[1], recipient round 1

        // Both Active
        (, , , , , , SavingsCircles.CircleState sA, , ) = sc.getCircle(idA);
        (, , , , , , SavingsCircles.CircleState sB, , ) = sc.getCircle(idB);
        assertEq(uint8(sA), uint8(SavingsCircles.CircleState.Active));
        assertEq(uint8(sB), uint8(SavingsCircles.CircleState.Active));

        // ---- Round 0 of both ----
        vm.prank(alice); sc.contribute(idA);
        vm.prank(bob);   sc.contribute(idA);
        vm.prank(carol); sc.contribute(idB);
        vm.prank(dave);  sc.contribute(idB);

        (, , , , , uint64 dlA0, , , ) = sc.getCircle(idA);
        vm.warp(dlA0 + 1);
        sc.closeRound(idA);
        sc.closeRound(idB);

        // Circle A: alice gets 2×100e6 = 200e6
        assertEq(sc.claimable(alice), 200e6, "alice claimable circle A round 0");
        // Circle B: carol gets 2×200e6 = 400e6
        assertEq(sc.claimable(carol), 400e6, "carol claimable circle B round 0");

        vm.prank(alice); sc.withdraw();
        vm.prank(carol); sc.withdraw();

        // ---- Round 1 (last round) of both ----
        vm.prank(alice); sc.contribute(idA);
        vm.prank(bob);   sc.contribute(idA);
        vm.prank(carol); sc.contribute(idB);
        vm.prank(dave);  sc.contribute(idB);

        (, , , , , uint64 dlA1, , , ) = sc.getCircle(idA);
        vm.warp(dlA1 + 1);
        sc.closeRound(idA);
        sc.closeRound(idB);

        // Circle A: bob gets pot(200e6) + deposit back(100e6) in one claimable
        // alice gets her deposit back (100e6)
        assertEq(sc.claimable(bob),   200e6 + 100e6, "bob claimable = r1 pot + deposit");
        assertEq(sc.claimable(alice), 100e6,          "alice deposit returned");
        // Circle B: dave gets pot(400e6) + deposit back(200e6)
        // carol gets her deposit back (200e6)
        assertEq(sc.claimable(dave),  400e6 + 200e6, "dave claimable = r1 pot + deposit");
        assertEq(sc.claimable(carol), 200e6,          "carol deposit returned");

        vm.prank(bob);   sc.withdraw();
        vm.prank(alice); sc.withdraw();
        vm.prank(dave);  sc.withdraw();
        vm.prank(carol); sc.withdraw();

        assertEq(usdc.balanceOf(address(sc)), 0, "contract balance = 0");

        // Each started with amount and got exactly that back
        // alice: minted 300, spent 300, received 200(r0) + 100(deposit) = 300 ✓
        assertEq(usdc.balanceOf(alice), 300e6, "alice net");
        assertEq(usdc.balanceOf(bob),   300e6, "bob net");
        assertEq(usdc.balanceOf(carol), 600e6, "carol net");
        assertEq(usdc.balanceOf(dave),  600e6, "dave net");

        // All four completed 1 circle
        _assertRep(alice, 1, 2, 0, 0);
        _assertRep(bob,   1, 2, 0, 0);
        _assertRep(carol, 1, 2, 0, 0);
        _assertRep(dave,  1, 2, 0, 0);
    }

    // =======================================================================
    // Test 8 — depositRounds=size-1=2: higher deposit covers two non-recipient misses
    // Alice misses every round. In rounds 1 and 2 she is NOT recipient → deposit covers.
    // In round 0 she IS recipient → recipient exemption (no deposit deduction, just Missed).
    // =======================================================================
    function test_depositRoundsSizeMinusOne() public {
        // depositRounds=2, deposit = 200e6 per member
        // Alice misses all 3 rounds (contributes nothing)
        // Bob & Carol pay all 3 rounds
        _fund(alice, 200e6);           // deposit only — never contributes
        _fund(bob,   200e6 + 3*100e6); // deposit + 3 rounds = 500e6
        _fund(carol, 200e6 + 3*100e6); // deposit + 3 rounds = 500e6

        uint256 id = _createCircle(3, 2);
        vm.prank(alice); sc.join(id); // member[0], recipient round 0
        vm.prank(bob);   sc.join(id); // member[1], recipient round 1
        vm.prank(carol); sc.join(id); // member[2], recipient round 2

        assertEq(sc.depositOf(id, alice), 200e6);
        assertEq(sc.depositOf(id, bob),   200e6);
        assertEq(sc.depositOf(id, carol), 200e6);

        // ---- Round 0: alice is recipient. Bob & Carol contribute. Alice misses (recipient exempt). ----
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);
        // Alice does NOT contribute

        (, , , , , uint64 dl0, , , ) = sc.getCircle(id);
        vm.warp(dl0 + 1);
        // Alice is recipient & misses: emit Missed, missedPayments++, NO deposit deduction
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Missed(id, alice, 0);
        // pot = bob(100) + carol(100) = 200e6 (alice's miss not covered by deposit)
        vm.expectEmit(true, false, true, true, address(sc));
        emit SavingsCircles.RoundClosed(id, 0, alice, 200e6);
        sc.closeRound(id);

        assertEq(sc.claimable(alice), 200e6, "alice round-0 pot");
        assertEq(sc.depositOf(id, alice), 200e6, "alice deposit unchanged (recipient exemption)");

        vm.prank(alice); sc.withdraw();

        // ---- Round 1: bob is recipient. Alice misses (NOT recipient → deposit deducted). ----
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);
        // Alice does NOT contribute — deposit 200e6 >= 100e6 → Missed, deposit → 100e6

        (, , , , , uint64 dl1, , , ) = sc.getCircle(id);
        vm.warp(dl1 + 1);
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Missed(id, alice, 1);
        // pot = bob(100) + carol(100) + alice's deposit(100) = 300e6
        vm.expectEmit(true, false, true, true, address(sc));
        emit SavingsCircles.RoundClosed(id, 1, bob, 300e6);
        sc.closeRound(id);

        assertEq(sc.claimable(bob), 300e6, "bob full pot round 1");
        assertEq(sc.depositOf(id, alice), 100e6, "alice deposit after r1 deduction");

        vm.prank(bob); sc.withdraw();

        // ---- Round 2: carol is recipient. Alice misses again (NOT recipient → deposit deducted). ----
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);
        // Alice does NOT contribute — deposit 100e6 >= 100e6 → Missed, deposit → 0

        (, , , , , uint64 dl2, , , ) = sc.getCircle(id);
        vm.warp(dl2 + 1);
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Missed(id, alice, 2);
        // pot = bob(100) + carol(100) + alice's deposit(100) = 300e6
        vm.expectEmit(true, false, true, true, address(sc));
        emit SavingsCircles.RoundClosed(id, 2, carol, 300e6);
        sc.closeRound(id); // last round → CircleFinished

        // After last closeRound: carol's pot (300e6) + carol's deposit return (200e6) = 500e6
        assertEq(sc.claimable(carol), 300e6 + 200e6, "carol pot + deposit returned");
        // Alice: deposit fully consumed by rounds 1+2 misses → 0 returned
        assertEq(sc.claimable(alice), 0, "alice no deposit returned");
        // Bob: deposit 200e6 untouched → returned
        assertEq(sc.claimable(bob),   200e6, "bob deposit returned");

        vm.prank(carol); sc.withdraw();
        vm.prank(bob);   sc.withdraw();
        // alice has 0 claimable (withdrew 200e6 earlier; nothing left)

        assertEq(usdc.balanceOf(address(sc)), 0, "contract = 0");

        // Alice: missedPayments=3 (rounds 0 as recipient miss, 1 and 2 as non-recipient)
        // defaults=0 (deposit always covered non-recipient misses), completedCircles=1, onTimePayments=0
        _assertRep(alice, 1, 0, 3, 0);
        // Bob: paid all 3 rounds
        _assertRep(bob,   1, 3, 0, 0);
        // Carol: paid all 3 rounds
        _assertRep(carol, 1, 3, 0, 0);
    }

    // =======================================================================
    // Test 9 — Recipient misses own round: pot short by exactly one contribution
    // =======================================================================
    function test_recipientMissesOwnRound() public {
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id); // member[0], recipient round 0
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);

        // Round 0: Bob and Carol contribute. Alice (recipient) does NOT.
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);

        (, , , , , uint64 dl0, , , ) = sc.getCircle(id);
        vm.warp(dl0 + 1);

        // Expect Missed for Alice (recipient miss: no deposit deduction)
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Missed(id, alice, 0);
        // Pot = Bob(100) + Carol(100) = 200e6 (NOT 300e6)
        vm.expectEmit(true, false, true, true, address(sc));
        emit SavingsCircles.RoundClosed(id, 0, alice, 200e6);
        sc.closeRound(id);

        // claimable[alice] = 200e6 (short by 100e6)
        assertEq(sc.claimable(alice), 200e6, "alice claimable = 200e6 (short pot)");
        // Alice deposit unchanged (recipient exemption)
        assertEq(sc.depositOf(id, alice), 100e6, "alice deposit unchanged = 100e6");

        // Continue circle to completion with all paying
        // Round 1: bob recipient, all contribute
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);
        _advanceAndClose(id);

        // Round 2: carol recipient, all contribute
        vm.prank(alice); sc.contribute(id);
        vm.prank(bob);   sc.contribute(id);
        vm.prank(carol); sc.contribute(id);
        _advanceAndClose(id); // last round → CircleFinished

        // Alice's deposit (100e6) returned at finish
        // claimable[alice] = 200e6 (r0 pot) + 100e6 (deposit) = 300e6
        assertEq(sc.claimable(alice), 200e6 + 100e6, "alice final claimable");

        vm.prank(alice); sc.withdraw();
        vm.prank(bob);   sc.withdraw();
        vm.prank(carol); sc.withdraw();

        assertEq(usdc.balanceOf(address(sc)), 0, "contract = 0");

        // Alice: missedPayments=1 (round 0 as recipient), completedCircles=1, onTimePayments=2
        _assertRep(alice, 1, 2, 1, 0);
        _assertRep(bob,   1, 3, 0, 0);
        _assertRep(carol, 1, 3, 0, 0);
    }

    // =======================================================================
    // Test 10 — createCircle: invalid depositRounds revert cases
    // =======================================================================
    function test_createCircleDepositRoundsReverts() public {
        // depositRounds=0 → InvalidDepositRounds
        vm.expectRevert(SavingsCircles.InvalidDepositRounds.selector);
        sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 3, 0);

        // depositRounds=size (=3) → InvalidDepositRounds
        vm.expectRevert(SavingsCircles.InvalidDepositRounds.selector);
        sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 3, 3);

        // depositRounds=size-1 (=2) → succeeds
        uint256 id = sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 3, 2);
        (, , uint8 sz, , , , , uint8 dr, ) = sc.getCircle(id);
        assertEq(sz, 3);
        assertEq(dr, 2);

        // depositRounds=1 → valid
        uint256 id2 = sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 3, 1);
        (, , , , , , , uint8 dr2, ) = sc.getCircle(id2);
        assertEq(dr2, 1);

        // size=2, depositRounds=1 (=size-1) → succeeds
        uint256 id3 = sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 2, 1);
        (, , uint8 sz3, , , , , uint8 dr3, ) = sc.getCircle(id3);
        assertEq(sz3, 2);
        assertEq(dr3, 1);

        // size=2, depositRounds=2 (=size) → fails
        vm.expectRevert(SavingsCircles.InvalidDepositRounds.selector);
        sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 2, 2);

        // Other createCircle reverts
        vm.expectRevert(SavingsCircles.InvalidContribution.selector);
        sc.createCircle(0, ROUND_LENGTH, 3, 1);

        vm.expectRevert(SavingsCircles.InvalidRoundLength.selector);
        sc.createCircle(CONTRIBUTION, 0, 3, 1);

        vm.expectRevert(SavingsCircles.InvalidSize.selector);
        sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 1, 1);

        vm.expectRevert(SavingsCircles.InvalidSize.selector);
        sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 21, 1);
    }

    // =======================================================================
    // Test 11 — Events emitted by createCircle and join
    // =======================================================================
    function test_events_createAndJoin() public {
        _fund(alice, 400e6);
        _fund(bob,   400e6);
        _fund(carol, 400e6);

        // CircleCreated event (id=0, creator=this test contract)
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.CircleCreated(0, address(this), CONTRIBUTION, ROUND_LENGTH, 3, 1);
        uint256 id = _createCircle(3, 1);
        assertEq(id, 0);

        // Joined(alice, 1)
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Joined(id, alice, 1);
        vm.prank(alice); sc.join(id);

        // Joined(bob, 2)
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Joined(id, bob, 2);
        vm.prank(bob); sc.join(id);

        // Joined(carol, 3) + CircleStarted on last join
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Joined(id, carol, 3);
        vm.prank(carol); sc.join(id);

        (, , , , , , SavingsCircles.CircleState state, , ) = sc.getCircle(id);
        assertEq(uint8(state), uint8(SavingsCircles.CircleState.Active));

        // ---- contribute + Contributed event ----
        vm.expectEmit(true, true, false, true, address(sc));
        emit SavingsCircles.Contributed(id, alice, 0);
        vm.prank(alice); sc.contribute(id);

        // ---- closeRound + RoundClosed event (alice paid, bob & carol didn't) ----
        (, , , , , uint64 dl, , , ) = sc.getCircle(id);
        vm.warp(dl + 1);
        vm.expectEmit(true, false, true, true, address(sc));
        // pot = alice(100) + bob's deposit(100) + carol's deposit(100) = 300e6
        emit SavingsCircles.RoundClosed(id, 0, alice, 300e6);
        sc.closeRound(id);

        // ---- Withdrawn event ----
        vm.expectEmit(true, false, false, true, address(sc));
        emit SavingsCircles.Withdrawn(alice, 300e6);
        vm.prank(alice); sc.withdraw();
    }

    // =======================================================================
    // Test 12 — getCircle, getMembers, hasPaid, depositOf view functions
    // =======================================================================
    function test_viewFunctions() public {
        _fund(alice, 300e6);
        _fund(bob,   300e6);
        _fund(carol, 300e6);

        uint256 id = _createCircle(3, 1);
        vm.prank(alice); sc.join(id);
        vm.prank(bob);   sc.join(id);
        vm.prank(carol); sc.join(id);

        // getMembers
        address[] memory members = sc.getMembers(id);
        assertEq(members.length, 3);
        assertEq(members[0], alice);
        assertEq(members[1], bob);
        assertEq(members[2], carol);

        // hasPaid: before contribute
        assertFalse(sc.hasPaid(id, 0, alice));

        vm.prank(alice); sc.contribute(id);

        // hasPaid: after contribute
        assertTrue(sc.hasPaid(id, 0, alice));
        assertFalse(sc.hasPaid(id, 0, bob));

        // depositOf
        assertEq(sc.depositOf(id, alice), 100e6);
        assertEq(sc.depositOf(id, bob),   100e6);

        // getCircle potForCurrentRound
        (, , , , , , , , uint256 pot1) = sc.getCircle(id);
        assertEq(pot1, 100e6, "pot after alice pays");

        vm.prank(bob); sc.contribute(id);
        (, , , , , , , , uint256 pot2) = sc.getCircle(id);
        assertEq(pot2, 200e6, "pot after bob pays");

        // CircleNotFound errors
        vm.expectRevert(SavingsCircles.CircleNotFound.selector);
        sc.getCircle(999);

        vm.expectRevert(SavingsCircles.CircleNotFound.selector);
        sc.getMembers(999);

        vm.expectRevert(SavingsCircles.CircleNotFound.selector);
        sc.hasPaid(999, 0, alice);

        vm.expectRevert(SavingsCircles.CircleNotFound.selector);
        sc.depositOf(999, alice);
    }

    // =======================================================================
    // Test 13 — nextCircleId increments correctly
    // =======================================================================
    function test_nextCircleIdIncrements() public {
        assertEq(sc.nextCircleId(), 0);
        sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 3, 1);
        assertEq(sc.nextCircleId(), 1);
        sc.createCircle(CONTRIBUTION, ROUND_LENGTH, 3, 1);
        assertEq(sc.nextCircleId(), 2);
    }

    // =======================================================================
    // Test 14 — Fuzz: createCircle accepts any valid params without reverting
    // =======================================================================
    function testFuzz_createCircleParams(
        uint256 contribution,
        uint64 roundLength,
        uint8 size,
        uint8 depositRounds
    ) public {
        contribution  = bound(contribution,  1, 1e30);
        roundLength   = uint64(bound(uint256(roundLength), 1, 365 days));
        size          = uint8(bound(uint256(size), 2, 20));
        depositRounds = uint8(bound(uint256(depositRounds), 1, uint256(size) - 1));

        uint256 id = sc.createCircle(contribution, roundLength, size, depositRounds);

        (
            uint256 c,
            uint64 rl,
            uint8 sz,
            ,
            ,
            ,
            SavingsCircles.CircleState st,
            uint8 dr,

        ) = sc.getCircle(id);

        assertEq(c,  contribution,  "contribution stored");
        assertEq(rl, roundLength,   "roundLength stored");
        assertEq(sz, size,          "size stored");
        assertEq(dr, depositRounds, "depositRounds stored");
        assertEq(uint8(st), uint8(SavingsCircles.CircleState.Pending), "state is Pending");
    }

    // =======================================================================
    // Internal helper: assert all four reputation fields in one call
    // =======================================================================
    function _assertRep(
        address who,
        uint256 expectedCC,
        uint256 expectedOTP,
        uint256 expectedMP,
        uint256 expectedD
    ) internal view {
        (uint256 cc, uint256 otp, uint256 mp, uint256 d) = sc.reputation(who);
        assertEq(cc,  expectedCC,  "completedCircles");
        assertEq(otp, expectedOTP, "onTimePayments");
        assertEq(mp,  expectedMP,  "missedPayments");
        assertEq(d,   expectedD,   "defaults");
    }
}
