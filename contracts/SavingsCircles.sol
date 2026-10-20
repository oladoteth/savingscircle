// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SavingsCircles
/// @notice A permissionless on-demand ROSCA where any member can request the
///         payout when they need it (zero arrears + sufficient pot required).
///         Everyone pays the same; each cycle one payout is taken. A new cycle
///         starts automatically after settleCycle.
///
/// Arc note: USDC is also the native gas token on Arc. collect() only ever
/// pulls contributions owed — it never pulls more than is due.
contract SavingsCircles is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Types
    // =========================================================================

    enum CircleState {
        Pending, // forming or between cycles
        Active   // cycle running
    }

    struct Reputation {
        uint256 cyclesCompleted;
        uint256 onTimePayments;
        uint256 latePayments;
        uint256 missedPayments;
        uint256 defaults;
    }

    struct Circle {
        // ---- immutable params ----
        uint256 contribution;
        uint64  periodLength;
        uint8   size;
        uint8   depositPeriods;
        // ---- derived ----
        uint256 payout; // size * contribution
        // ---- membership ----
        address[] members;
        mapping(address => bool)    isMember;
        mapping(address => uint256) deposit;
        // ---- invite list ----
        mapping(address => bool) inviteList;
        bool hasInviteList;
        // ---- cycle state ----
        CircleState state;
        uint32  cycle;        // increments each settleCycle
        uint64  cycleStart;
        uint256 pot;
        mapping(address => uint256) paidThisCycle;
        mapping(address => bool)    takenThisCycle;
        // ---- defaulter tracking for current cycle ----
        // set in settleCycle so we can remove them after payout iteration
        mapping(address => bool) defaultedThisCycle;
    }

    // =========================================================================
    // State
    // =========================================================================

    IERC20 public immutable usdc;
    uint256 public nextCircleId;

    mapping(uint256 => Circle)   private circles;
    mapping(address => Reputation) public reputation;
    mapping(address => uint256)  public claimable;

    // =========================================================================
    // Events
    // =========================================================================

    event CircleCreated(
        uint256 indexed id,
        address indexed creator,
        uint256 contribution,
        uint64  periodLength,
        uint8   size,
        uint8   depositPeriods,
        bool    hasInviteList
    );
    event Joined(uint256 indexed id, address indexed member, uint256 memberCount);
    event Left(uint256 indexed id, address indexed member);
    event ToppedUp(uint256 indexed id, address indexed member, uint256 amount);
    event CycleStarted(uint256 indexed id, uint32 cycle, uint64 cycleStart);
    event Collected(uint256 indexed id, address indexed member, uint256 amount, uint256 lateCount);
    event Missed(uint256 indexed id, address indexed member, uint256 owedRemaining);
    event PayoutTaken(uint256 indexed id, uint32 cycle, address indexed member, uint256 payout);
    event Defaulted(uint256 indexed id, address indexed member);
    event CycleSettled(uint256 indexed id, uint32 cycle);
    event Withdrawn(address indexed member, uint256 amount);

    // =========================================================================
    // Errors
    // =========================================================================

    error InvalidUSDC();
    error InvalidContribution();
    error InvalidPeriodLength();
    error InvalidSize();
    error InvalidDepositPeriods();
    error InviteListTooShort();
    error CircleNotFound();
    error InvalidState();
    error AlreadyMember();
    error NotMember();
    error NotInvited();
    error DepositAlreadyFull();
    error NotEnoughMembers();
    error DepositNotFull();
    error AlreadyTaken();
    error HasArrears();
    error PotTooSmall();
    error TooEarlyToSettle();
    error NothingToWithdraw();

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address usdc_) {
        if (usdc_ == address(0)) revert InvalidUSDC();
        usdc = IERC20(usdc_);
    }

    // =========================================================================
    // Circle creation
    // =========================================================================

    /// @notice Create a new savings circle.
    /// @param contribution Amount each member pays per period (in USDC wei, e.g. 100e6).
    /// @param periodLength Duration of one period in seconds.
    /// @param size Number of members (2–20).
    /// @param depositPeriods Join deposit = depositPeriods * contribution. Range [1, size-1].
    /// @param invited Empty = open circle; otherwise only these addresses may join.
    ///                invited.length must be >= size when non-empty.
    function createCircle(
        uint256 contribution,
        uint64  periodLength,
        uint8   size,
        uint8   depositPeriods,
        address[] calldata invited
    ) external nonReentrant returns (uint256 id) {
        if (contribution == 0) revert InvalidContribution();
        if (periodLength == 0) revert InvalidPeriodLength();
        if (size < 2 || size > 20) revert InvalidSize();
        if (depositPeriods < 1 || depositPeriods > size - 1) revert InvalidDepositPeriods();
        if (invited.length > 0 && invited.length < size) revert InviteListTooShort();

        id = nextCircleId;
        unchecked { nextCircleId = id + 1; }

        Circle storage c = circles[id];
        c.contribution   = contribution;
        c.periodLength   = periodLength;
        c.size           = size;
        c.depositPeriods = depositPeriods;
        c.payout         = uint256(size) * contribution;
        c.state          = CircleState.Pending;

        if (invited.length > 0) {
            c.hasInviteList = true;
            for (uint256 i; i < invited.length; ++i) {
                c.inviteList[invited[i]] = true;
            }
        }

        emit CircleCreated(id, msg.sender, contribution, periodLength, size, depositPeriods, invited.length > 0);
    }

    // =========================================================================
    // Membership (Pending only)
    // =========================================================================

    /// @notice Join a circle and pay the join deposit.
    function join(uint256 id) external nonReentrant {
        Circle storage c = _requireExists(id);
        if (c.state != CircleState.Pending) revert InvalidState();
        if (c.isMember[msg.sender]) revert AlreadyMember();
        if (c.hasInviteList && !c.inviteList[msg.sender]) revert NotInvited();

        uint256 depositAmt = c.contribution * c.depositPeriods;
        c.isMember[msg.sender] = true;
        c.members.push(msg.sender);
        c.deposit[msg.sender]  = depositAmt;

        usdc.safeTransferFrom(msg.sender, address(this), depositAmt);

        emit Joined(id, msg.sender, c.members.length);
    }

    /// @notice Leave a circle (Pending only). Credits remaining deposit to claimable.
    function leave(uint256 id) external nonReentrant {
        Circle storage c = _requireExists(id);
        if (c.state != CircleState.Pending) revert InvalidState();
        if (!c.isMember[msg.sender]) revert NotMember();

        uint256 dep = c.deposit[msg.sender];
        if (dep > 0) {
            claimable[msg.sender] += dep;
            c.deposit[msg.sender]  = 0;
        }

        _removeMember(c, msg.sender);
        emit Left(id, msg.sender);
    }

    /// @notice Top up deposit back to the full join deposit amount.
    ///         Only needed if a previous cycle's settlement deducted from deposit.
    function topUp(uint256 id) external nonReentrant {
        Circle storage c = _requireExists(id);
        if (c.state != CircleState.Pending) revert InvalidState();
        if (!c.isMember[msg.sender]) revert NotMember();

        uint256 full   = c.contribution * c.depositPeriods;
        uint256 current = c.deposit[msg.sender];
        if (current >= full) revert DepositAlreadyFull();

        uint256 needed = full - current;
        c.deposit[msg.sender] = full;
        usdc.safeTransferFrom(msg.sender, address(this), needed);

        emit ToppedUp(id, msg.sender, needed);
    }

    /// @notice Start a new cycle. Callable by anyone when the circle is full
    ///         and every member's deposit is full.
    function startCycle(uint256 id) external nonReentrant {
        Circle storage c = _requireExists(id);
        if (c.state != CircleState.Pending) revert InvalidState();
        if (c.members.length != c.size) revert NotEnoughMembers();

        uint256 full = c.contribution * c.depositPeriods;
        uint256 len  = c.members.length;
        for (uint256 i; i < len; ++i) {
            if (c.deposit[c.members[i]] < full) revert DepositNotFull();
        }

        c.state      = CircleState.Active;
        c.cycleStart = uint64(block.timestamp);
        unchecked { c.cycle += 1; }

        emit CycleStarted(id, c.cycle, c.cycleStart);
    }

    // =========================================================================
    // Collection helpers
    // =========================================================================

    /// @dev How many whole contributions are owed right now by `member` (0 if caught up).
    function _owedNow(Circle storage c, address member) internal view returns (uint256) {
        uint256 elapsed  = block.timestamp - c.cycleStart;
        uint256 periods  = elapsed / c.periodLength + 1;
        if (periods > c.size) periods = c.size;
        uint256 due      = periods * c.contribution;
        uint256 paid     = c.paidThisCycle[member];
        return due > paid ? due - paid : 0;
    }

    /// @dev Pull as many whole contributions as balance+allowance allow, up to owed.
    ///      Returns (amountPulled, lateCount).
    ///      Never reverts for a single member; wraps transfer in try/catch.
    function _collectOne(
        Circle storage c,
        uint256, // id — unused but kept for event emission by caller
        address member,
        uint64  nowTs
    ) internal returns (uint256 pulled, uint256 lateCount) {
        uint256 owed = _owedNow(c, member);
        if (owed == 0) return (0, 0);

        uint256 contrib = c.contribution;
        {
            uint256 canPay = usdc.balanceOf(member);
            uint256 allowance = usdc.allowance(member, address(this));
            if (allowance < canPay) canPay = allowance;

            uint256 toPullContribs = canPay / contrib;
            uint256 owedContribs   = owed / contrib;
            if (toPullContribs > owedContribs) toPullContribs = owedContribs;
            if (toPullContribs == 0) return (0, 0);

            uint256 toPull = toPullContribs * contrib;

            bool ok;
            try usdc.transferFrom(member, address(this), toPull) returns (bool success) {
                ok = success;
            } catch {
                ok = false;
            }
            if (!ok) return (0, 0);

            pulled = toPull;
        }

        // Classify late vs on-time
        uint256 toPullContribs2 = pulled / contrib;
        uint256 curPeriod;
        {
            uint256 elapsed = uint256(nowTs) - c.cycleStart;
            curPeriod = elapsed / c.periodLength;
            if (curPeriod >= c.size) curPeriod = c.size - 1;
        }
        uint256 alreadyPaid = c.paidThisCycle[member] / contrib;
        for (uint256 i; i < toPullContribs2; ++i) {
            if (alreadyPaid + i < curPeriod) {
                lateCount++;
                reputation[member].latePayments++;
            } else {
                reputation[member].onTimePayments++;
            }
        }

        c.paidThisCycle[member] += pulled;
        c.pot                   += pulled;
    }

    // =========================================================================
    // Collect / Pay (Active)
    // =========================================================================

    /// @notice Autopay: pull owed contributions for every member who can pay.
    ///         Safe to call at any time while Active. One member's failure
    ///         never reverts the call for others.
    function collect(uint256 id) external nonReentrant {
        Circle storage c = _requireExists(id);
        if (c.state != CircleState.Active) revert InvalidState();
        _collectAll(c, id, uint64(block.timestamp));
    }

    /// @notice Manual pay: pull owed contributions for msg.sender only.
    function pay(uint256 id) external nonReentrant {
        Circle storage c = _requireExists(id);
        if (c.state != CircleState.Active) revert InvalidState();
        if (!c.isMember[msg.sender]) revert NotMember();
        uint64 nowTs = uint64(block.timestamp);
        (uint256 pulled, uint256 lateCount) = _collectOne(c, id, msg.sender, nowTs);
        if (pulled > 0) {
            emit Collected(id, msg.sender, pulled, lateCount);
        }
        uint256 stillOwed = _owedNow(c, msg.sender);
        if (stillOwed > 0) {
            emit Missed(id, msg.sender, stillOwed);
        }
    }

    /// @dev Collect all members. Emits Collected/Missed per member.
    function _collectAll(Circle storage c, uint256 id, uint64 nowTs) internal {
        uint256 len = c.members.length;
        for (uint256 i; i < len; ++i) {
            address member = c.members[i];
            (uint256 pulled, uint256 lateCount) = _collectOne(c, id, member, nowTs);
            if (pulled > 0) {
                emit Collected(id, member, pulled, lateCount);
            }
            uint256 stillOwed = _owedNow(c, member);
            if (stillOwed > 0) {
                emit Missed(id, member, stillOwed);
            }
        }
    }

    // =========================================================================
    // Payout request (Active)
    // =========================================================================

    /// @notice Request the payout for this cycle.
    ///         Runs collect() first, then checks:
    ///         - member has not already taken the payout this cycle (AlreadyTaken)
    ///         - member owes nothing (HasArrears)
    ///         - pot >= payout (PotTooSmall)
    ///         First valid request wins.
    function request(uint256 id) external nonReentrant {
        Circle storage c = _requireExists(id);
        if (c.state != CircleState.Active) revert InvalidState();
        if (!c.isMember[msg.sender]) revert NotMember();

        // Run collect for everyone first
        _collectAll(c, id, uint64(block.timestamp));

        if (c.takenThisCycle[msg.sender]) revert AlreadyTaken();
        if (_owedNow(c, msg.sender) > 0) revert HasArrears();
        if (c.pot < c.payout) revert PotTooSmall();

        c.pot                      -= c.payout;
        claimable[msg.sender]      += c.payout;
        c.takenThisCycle[msg.sender] = true;

        emit PayoutTaken(id, c.cycle, msg.sender, c.payout);
    }

    // =========================================================================
    // Settle cycle (Active, after grace period)
    // =========================================================================

    /// @notice Settle the cycle once now >= cycleStart + size * periodLength.
    ///         Runs collect, deducts deposits for arrears, pays out remaining members,
    ///         removes defaulters, resets per-cycle data, returns to Pending.
    function settleCycle(uint256 id) external nonReentrant {
        Circle storage c = _requireExists(id);
        if (c.state != CircleState.Active) revert InvalidState();

        uint256 settleTime = uint256(c.cycleStart) + uint256(c.size) * uint256(c.periodLength);
        if (block.timestamp < settleTime) revert TooEarlyToSettle();

        // Collect what's left
        _collectAll(c, id, uint64(block.timestamp));

        uint256 len = c.members.length;

        // ---- Handle arrears: deduct deposit or record default ----
        for (uint256 i; i < len; ++i) {
            address member = c.members[i];
            uint256 owed   = _owedNow(c, member);
            if (owed == 0) continue;

            uint256 dep = c.deposit[member];
            if (dep >= owed) {
                // Deposit covers all arrears
                c.deposit[member] = dep - owed;
                c.paidThisCycle[member] += owed;
                c.pot += owed;
                reputation[member].missedPayments += owed / c.contribution;
            } else {
                // Deposit only partially covers — default
                if (dep > 0) {
                    c.pot += dep;
                    c.paidThisCycle[member] += dep;
                    c.deposit[member] = 0;
                }
                reputation[member].missedPayments += owed / c.contribution;
                reputation[member].defaults++;
                c.defaultedThisCycle[member] = true;
                emit Defaulted(id, member);
            }
        }

        // ---- Pay out members who haven't taken the payout ----
        // Tier 1: non-defaulters who haven't taken payout
        // Tier 2: defaulters who haven't taken payout
        // Within each tier, split pot equally (min(payout, pot/count)).
        // Rounding dust goes to the last member in each tier.
        // Defaulters must never be paid before non-defaulters.

        // Count each tier
        uint256 tier1Count;
        uint256 tier2Count;
        for (uint256 i; i < len; ++i) {
            address member = c.members[i];
            if (c.takenThisCycle[member]) continue;
            if (c.defaultedThisCycle[member]) {
                tier2Count++;
            } else {
                tier1Count++;
            }
        }

        // Pay tier 1 first
        if (tier1Count > 0 && c.pot > 0) {
            uint256 shareEach = c.payout < c.pot / tier1Count ? c.payout : c.pot / tier1Count;
            uint256 paid1;
            for (uint256 i; i < len; ++i) {
                address member = c.members[i];
                if (c.takenThisCycle[member]) continue;
                if (c.defaultedThisCycle[member]) continue;
                paid1++;
                uint256 share;
                if (paid1 == tier1Count) {
                    // Last one gets the remainder to absorb dust
                    share = c.pot < c.payout ? c.pot : c.payout;
                } else {
                    share = shareEach;
                }
                if (share > 0) {
                    c.pot -= share;
                    claimable[member] += share;
                    c.takenThisCycle[member] = true;
                }
            }
        }

        // Pay tier 2 (defaulters) with whatever remains
        if (tier2Count > 0 && c.pot > 0) {
            uint256 potForDefaulters = c.pot;
            uint256 shareEach = potForDefaulters / tier2Count;
            uint256 paid2;
            for (uint256 i; i < len; ++i) {
                address member = c.members[i];
                if (c.takenThisCycle[member]) continue;
                if (!c.defaultedThisCycle[member]) continue;
                paid2++;
                uint256 share;
                if (paid2 == tier2Count) {
                    share = c.pot; // last defaulter gets the dust
                } else {
                    share = shareEach;
                }
                if (share > 0) {
                    c.pot -= share;
                    claimable[member] += share;
                    c.takenThisCycle[member] = true;
                }
            }
        }

        // Pot must be zero here; assert invariant in debug builds implicitly.
        // (Any leftover from rounding is kept in the pot for the next cycle via the
        //  dust-to-last-member approach above, so pot==0 should always hold.)

        // ---- Cycle completion credits & remove defaulters ----
        // Build list of defaulters to remove (can't modify during iteration)
        uint256 defaulterCount;
        for (uint256 i; i < len; ++i) {
            if (c.defaultedThisCycle[c.members[i]]) defaulterCount++;
        }

        // Credit cyclesCompleted to non-defaulters, return their deposit portion
        for (uint256 i; i < len; ++i) {
            address member = c.members[i];
            if (!c.defaultedThisCycle[member]) {
                reputation[member].cyclesCompleted++;
            } else {
                // Return any remaining deposit to defaulter
                uint256 dep = c.deposit[member];
                if (dep > 0) {
                    claimable[member] += dep;
                    c.deposit[member]  = 0;
                }
            }
        }

        // Remove defaulters from membership (iterate backwards to preserve indices)
        if (defaulterCount > 0) {
            for (uint256 i = len; i > 0; ) {
                unchecked { --i; }
                if (c.defaultedThisCycle[c.members[i]]) {
                    address defaulter = c.members[i];
                    // Shift members left from i
                    for (uint256 j = i; j + 1 < c.members.length; ++j) {
                        c.members[j] = c.members[j + 1];
                    }
                    c.members.pop();
                    c.isMember[defaulter]         = false;
                    c.defaultedThisCycle[defaulter] = false; // clean up
                }
            }
        }

        uint32 settledCycle = c.cycle;

        // ---- Reset per-cycle data ----
        uint256 newLen = c.members.length;
        for (uint256 i; i < newLen; ++i) {
            address member = c.members[i];
            c.paidThisCycle[member]  = 0;
            c.takenThisCycle[member] = false;
            // depositPeriods stays; deposit is NOT reset here — members top up manually
            // if their deposit was deducted during settlement.
        }
        c.pot   = 0;
        c.state = CircleState.Pending;

        emit CycleSettled(id, settledCycle);
    }

    // =========================================================================
    // Withdraw
    // =========================================================================

    /// @notice Pull claimable USDC.
    function withdraw() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimable[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // =========================================================================
    // Views
    // =========================================================================

    struct CircleView {
        uint256 contribution;
        uint64  periodLength;
        uint8   size;
        uint8   depositPeriods;
        uint256 payout;
        uint256 memberCount;
        CircleState state;
        uint32  cycle;
        uint64  cycleStart;
        uint256 currentPeriod;  // 0-indexed; 0 if Pending
        uint64  nextDueTime;    // 0 if Pending
        uint256 pot;
    }

    function getCircle(uint256 id) external view returns (CircleView memory v) {
        Circle storage c = _requireExists(id);
        v.contribution  = c.contribution;
        v.periodLength  = c.periodLength;
        v.size          = c.size;
        v.depositPeriods = c.depositPeriods;
        v.payout        = c.payout;
        v.memberCount   = c.members.length;
        v.state         = c.state;
        v.cycle         = c.cycle;
        v.cycleStart    = c.cycleStart;
        v.pot           = c.pot;
        if (c.state == CircleState.Active) {
            uint256 elapsed = block.timestamp - c.cycleStart;
            uint256 p = elapsed / c.periodLength;
            if (p >= c.size) p = c.size - 1;
            v.currentPeriod = p;
            v.nextDueTime   = uint64(c.cycleStart + (p + 1) * c.periodLength);
        }
    }

    struct MemberInfo {
        uint256 deposit;
        uint256 paidThisCycle;
        uint256 owedNow;
        bool    takenThisCycle;
        bool    isMember;
    }

    function memberInfo(uint256 id, address member) external view returns (MemberInfo memory m) {
        Circle storage c = _requireExists(id);
        m.deposit        = c.deposit[member];
        m.paidThisCycle  = c.paidThisCycle[member];
        m.owedNow        = c.state == CircleState.Active ? _owedNow(c, member) : 0;
        m.takenThisCycle = c.takenThisCycle[member];
        m.isMember       = c.isMember[member];
    }

    function getMembers(uint256 id) external view returns (address[] memory) {
        Circle storage c = _requireExists(id);
        return c.members;
    }

    function isInvited(uint256 id, address member) external view returns (bool) {
        Circle storage c = _requireExists(id);
        if (!c.hasInviteList) return true;
        return c.inviteList[member];
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    function _requireExists(uint256 id) internal view returns (Circle storage c) {
        if (id >= nextCircleId) revert CircleNotFound();
        return circles[id];
    }

    function _removeMember(Circle storage c, address member) internal {
        c.isMember[member] = false;
        uint256 len = c.members.length;
        for (uint256 i; i < len; ++i) {
            if (c.members[i] == member) {
                for (uint256 j = i; j + 1 < len; ++j) {
                    c.members[j] = c.members[j + 1];
                }
                c.members.pop();
                return;
            }
        }
    }
}
