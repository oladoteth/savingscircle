# SavingsCircles v2 — Security Review

Date: 2026-10-20 (updated 2026-10-20)
Contract: `contracts/SavingsCircles.sol`
Severity requested: balanced
Chain target: Arc Testnet (EVM, chain ID 5042002; USDC is native gas token)

Two independent reviews were run (rule-corpus and functional). Results are merged below.

---

## Rule-corpus review

**Result: No material findings.**

All standard Solidity security patterns were checked: reentrancy, integer overflow/underflow,
access control, ERC-20 interaction, DOS vectors, front-running. The use of `ReentrancyGuard`
on every external function and `SafeERC20` throughout, combined with the pull-based `withdraw()`
pattern, gives a clean baseline.

The intentional `try/catch` wrapping of `transferFrom` inside `_collectOne` was noted and
treated as a known design decision, not a vulnerability.

---

## Functional review

### Finding 1 — CRITICAL: settleCycle pot-zero reset could strand arrears-deducted funds

**Status: FIXED in this commit.**

**Location:** `settleCycle` — the `c.pot = 0` reset at the end.

**Description:**
The function forced `c.pot = 0` as part of the reset after the payout tiers. If arrears
processing added value to the pot (via deposit deductions) but both `tier1Count` and
`tier2Count` were zero (all members already took the payout mid-cycle), the pot value would
be zeroed without crediting anyone.

**Example scenario:** 3-member circle, all three take payouts mid-cycle. At settlement, one
member has arrears; their deposit is added to `c.pot`. After payout tiers (nothing to pay out
since all took it), `c.pot` was reset to 0. That USDC would be permanently stranded.

**Fix applied:**
A dust-sweep block was added after both payout tiers. If `c.pot > 0` after the tiers:
- If any member was paid in the settlement tiers, the residual is credited to `lastPaid`.
- If nobody was paid (all took mid-cycle), the residual is split equally among surviving
  non-defaulting members (or all members if all defaulted).
`c.pot = 0` at the end now serves as an explicit assertion — the sweep guarantees it is
already zero before that line. `testFuzz_balanceInvariant` now asserts `pot == 0` after
every `settleCycle`.

---

### Finding 2 — HIGH: Multiple members can take the payout in one cycle

**Status: BY DESIGN — no change.**

**Location:** `request()` — `takenThisCycle[member]` guard.

**Assessment:**
This is the intended behavior. Each member may take the payout **once per cycle**, whenever
they need it, provided they have zero arrears and the pot holds at least one full payout.
`takenThisCycle[msg.sender]` is the correct and sufficient guard for this mechanic.

The NatSpec on `request()` and the contract-level `@notice` have been updated to make this
explicit: *"Each member may take the payout once per cycle, whenever they need it."*

The economic guarantee of tests 6 and 7 (Bob and Carol receive at least a full payout even
when Alice takes early) relies on the deposit requirement, not on a single-winner limit.
With `depositPeriods = size-1`, Alice's deposit covers all remaining contributions she owes,
ensuring the pot is never short for other members.

---

### Finding 3 — HIGH: Single non-cooperative member can stall startCycle indefinitely

**Status: FIXED in this commit.**

**Location:** `startCycle()` — `DepositNotFull` check.

**Description:**
After a cycle where a member's deposit was partially consumed by settlement, that member must
call `topUp()` before the next cycle can start. With no timeout or forced ejection path, one
member could block the circle indefinitely.

**Fix applied:**
`removeUnfunded(uint256 id, address member)` was added. Anyone may call it while Pending,
but only after at least one `periodLength` has elapsed since the last `settleCycle`
(`settledAt` stored on the circle). It credits the member's remaining deposit to `claimable`
and removes them from membership, emitting `Removed(id, member)`. A full-deposit member
reverts with `DepositAlreadyFull`.

---

### Finding 4 (new, caught this round) — MEDIUM: join() allowed joining a full circle

**Status: FIXED in this commit.**

**Location:** `join()` — no membership-count check.

**Description:**
`join()` had no guard against joining a circle that had already reached `size` members. An
extra member could join an open circle between `join()` and `startCycle()`, causing
`startCycle` to fail with `NotEnoughMembers` since it checks `members.length != size`.
Worse, if `size` members had joined and one left, then two members could race to refill the
slot, potentially exceeding `size`.

**Fix applied:**
`if (c.members.length >= c.size) revert CircleFull();` was added to `join()`.
New `error CircleFull()` declared. Test 14 covers: full circle rejects a joiner; after a
member leaves, the slot opens and the next joiner succeeds.

---

## Summary table

| # | Title | Severity | Status |
|---|---|---|---|
| 1 | settleCycle pot-zero reset could strand arrears-deducted funds | Critical | Fixed |
| 2 | Multiple members can take the payout in one cycle | High | By design |
| 3 | Single member can stall `startCycle` indefinitely | High | Fixed (removeUnfunded) |
| 4 | `join()` allowed joining a full circle | Medium | Fixed (CircleFull guard) |
| — | Rule-corpus review | — | No findings |

---

*No contract logic was changed for Finding 2.*
