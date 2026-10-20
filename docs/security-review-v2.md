# SavingsCircles v2 — Security Review

Date: 2026-10-20
Contract: `contracts/SavingsCircles.sol`
Severity requested: balanced
Chain target: Arc Testnet (EVM, chain ID 5042002; USDC is native gas token)

Two independent reviews were run (rule-corpus and functional). Results are merged below.

---

## Rule-corpus review

**Result: No material findings.**

All standard Solidity security patterns were checked: reentrancy, integer overflow/underflow, access control, ERC-20 interaction, DOS vectors, front-running. The use of `ReentrancyGuard` on every external function and `SafeERC20` throughout, combined with the pull-based `withdraw()` pattern, gives a clean baseline.

The intentional `try/catch` wrapping of `transferFrom` inside `_collectOne` was noted and treated as a known design decision, not a vulnerability.

---

## Functional review

### Finding 1 — CRITICAL: settleCycle pot-zero reset can strand funds

**Location:** `settleCycle` lines ~450–566 (the `c.pot = 0` reset at the end)

**Description:**
The function forces `c.pot = 0` as part of the reset after the payout tiers. If arrears processing added value to the pot (via deposit deductions) but both `tier1Count` and `tier2Count` are zero (all members already took the payout mid-cycle), the pot value is zeroed without crediting anyone. The USDC has been transferred in and is now locked with no claim path.

**Example scenario:** 3-member circle, all three take payouts mid-cycle. At settlement, one member has arrears; their deposit is added to `c.pot`. After payout tiers (nothing to pay out since all took it), `c.pot` is reset to 0. That USDC is permanently stranded.

**Recommendation:**
Before `c.pot = 0`, assert `c.pot == 0` (a strict invariant check), or credit any residual pot to the last non-defaulting member. The dust-to-last-member approach in the tier loops should logically prevent leftover, but the edge case above (all took mid-cycle, deposit deducted at settle) is not covered.

---

### Finding 2 — HIGH: Multiple members can take the payout in one cycle

**Location:** `request()` lines ~378–395

**Description:**
`takenThisCycle[member]` prevents one member from calling `request` twice, but does NOT prevent a second member from calling `request` once the pot refills. Because contributions accumulate in the pot across multiple collect() calls throughout the cycle, the pot can reach `>= payout` multiple times. Any zero-arrears member can call `request` whenever the pot crosses the threshold — potentially more than one payout can be distributed in a single cycle.

This contradicts the stated design ("each cycle one payout is taken; a new cycle starts after settleCycle") and the economic guarantee that test 6 and test 7 rely on (Bob and Carol receive the full payout at settle only because Alice was the only requester).

**Recommendation:**
Add a cycle-global flag `payoutTakenThisCycle` (or track a counter) and revert all subsequent `request` calls once one payout has been granted for that cycle.

---

### Finding 3 — HIGH: Single non-cooperative member can stall startCycle indefinitely

**Location:** `startCycle()` line ~236–241 (the `DepositNotFull` check)

**Description:**
After a cycle where a member's deposit was partially consumed by settlement, that member must call `topUp()` before the next cycle can start. There is no timeout, no forced ejection, and no permissionless removal for a member who refuses to top up. A single member can block the circle from starting another cycle forever.

This is an availability risk: all other members' deposits are locked in the contract with no way to force progress or dissolve the circle.

**Recommendation:**
Add a liveness mechanism: for example, a configurable deadline after which any member can forcibly eject a non-topped-up member (returning their deposit to `claimable`), or allow the circle to dissolve and return all deposits if `startCycle` is not called within a grace period.

---

## Summary table

| # | Title | Severity |
|---|---|---|
| 1 | settleCycle pot-zero reset can strand arrears-deducted funds | **Critical** |
| 2 | Multiple members can take the payout in one cycle | **High** |
| 3 | Single member can stall `startCycle` indefinitely | **High** |
| — | Rule-corpus review | No findings |

---

*Note: No contract code was changed as part of this review.*
