# SavingsCircles

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app.

---

## What This App Does

An on-demand ROSCA (ajo, tanda, susu) on Arc. Members save together with autopay contributions. There is no fixed payout schedule — any member with zero arrears can request the payout when they need it, provided the pot holds enough. Each cycle exactly one payout is taken. After settlement the circle returns to Pending for the next cycle.

## Deployed Contracts

| Contract | Network | Address | Notes |
|---|---|---|---|
| SavingsCircles v1 | Arc Testnet | [0xe4a39b29fee8942eafed5798105ae8982b0662f5](https://explorer.testnet.arc.io/address/0xe4a39b29fee8942eafed5798105ae8982b0662f5) | Old join-order model; superseded |
| SavingsCircles v2 | Arc Testnet | (not yet deployed) | On-demand model; deploy before use |

## Contract: SavingsCircles v2 (`contracts/SavingsCircles.sol`)

### Parameters

`createCircle(uint256 contribution, uint64 periodLength, uint8 size, uint8 depositPeriods, address[] calldata invited)`

- `payout = size × contribution` (fixed).
- `depositPeriods` in [1, size−1]. Join deposit = `depositPeriods × contribution`.
- `invited`: empty = open; non-empty and `invited.length >= size` = restricted.
- Validation: contribution > 0, periodLength > 0, size in [2, 20].

### States

`Pending` (forming or between cycles) ↔ `Active` (cycle running).

### Membership (Pending only)

- `join(id)` — pulls the full deposit. **Deposits stay locked between cycles** and are only returned via `leave()` or on default.
- `leave(id)` — credits remaining deposit to `claimable`, removes member.
- `topUp(id)` — pulls the shortfall to bring deposit back to full. Required after settlement deducted from a deposit.
- `startCycle(id)` — anyone, when `memberCount == size` and every deposit is full. Sets `cycleStart = block.timestamp`, increments `cycle`.

### Cycle mechanics

Periods: t = 0 to size−1. Contribution for period t is due at `cycleStart + t × periodLength`.

- `collect(id)` — pulls owed whole contributions for every member (try/catch, never reverts for callers). Late vs on-time classified per period boundary.
- `pay(id)` — same as collect but for `msg.sender` only.
- `request(id)` — member only, Active only. Runs collect first. Reverts: `AlreadyTaken`, `HasArrears`, `PotTooSmall`. Credits `claimable[msg.sender] += payout`, marks `takenThisCycle`.
- `settleCycle(id)` — anyone, after `cycleStart + size × periodLength`. Collects remaining owed, deducts deposits (default if insufficient), pays tier1 (non-defaulters) then tier2 (defaulters), removes defaulters, resets per-cycle data, → Pending.

### Reputation per address

`cyclesCompleted`, `onTimePayments`, `latePayments`, `missedPayments`, `defaults`.

### Constructor

`constructor(address usdc_)` — Arc USDC: `0x3600000000000000000000000000000000000000`

### Tests

16 tests, all passing (`forge test`). Run with `bun run contracts:test`.

| # | Test function | Covers |
|---|---|---|
| 1 | `test_happyPath` | Full cycle, payouts out of join order, balance invariant |
| 2 | `test_requestReverts` | PotTooSmall, AlreadyTaken, HasArrears, NotMember, not Active |
| 3 | `test_emptyWalletThenLate` | Collect skips zero-balance; next collect pulls arrears as late |
| 4 | `test_revertingTokenSkippedInCollect` | Reverting token skipped; others succeed |
| 5 | `test_allowanceTooLow` | Low-allowance member skipped; others collected |
| 6 | `test_depositPeriodsSizeMinusOne_noDefault` | depositPeriods=size−1; Alice takes early, no default, Bob+Carol get full payout |
| 7 | `test_depositPeriods1_defaultAndRemoval` | depositPeriods=1; Alice defaults, Bob+Carol each get 250e6 (2.5 contributions) |
| 8 | `test_settleTooEarly` | TooEarlyToSettle revert; exact boundary succeeds |
| 9 | `test_secondCycle` | Leave+join+topUp between cycles; cyclesCompleted increments |
| 10a | `test_startCycleNotEnoughAndActiveReverts` | NotEnoughMembers; join/leave while Active revert |
| 10b | `test_depositNotFull` | DepositNotFull blocks startCycle; topUp restores it |
| 11 | `test_inviteList` | Uninvited revert; invited works; InviteListTooShort revert |
| 12 | `test_withdraw` | Exact amount; second call reverts NothingToWithdraw |
| 12b | `test_withdrawReentrancy` | Reentrant token cannot double-withdraw |
| 13a | `testFuzz_createCircleParams` | Valid params never revert; stored correctly |
| 13b | `testFuzz_balanceInvariant` | Random pay/miss patterns; balance invariant holds |

### Security review findings (v2, 2026-10-20)

Three findings from the functional review. Rule-corpus review returned no findings. Full report: `docs/security-review-v2.md`. No code was changed.

| Severity | Finding |
|---|---|
| Critical | `settleCycle` pot-zero reset can strand funds when all members took the payout mid-cycle |
| High | Multiple members can take the payout in one cycle (pot refills between collect calls) |
| High | One member can stall `startCycle` indefinitely by refusing to `topUp` |

### Known limitation: reputation farming

On-chain reputation counters are not Sybil-resistant. A person controlling multiple wallets can build a record at low cost. Treat on-chain reputation as one signal alongside personal trust and social context.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Build: `bun run contracts:build`. Test: `bun run contracts:test`.
- Chain: Arc Testnet (Chain ID: 5042002)
- Token: USDC (6 decimals, `0x3600000000000000000000000000000000000000`)

## Key Files

- `src/appConfig.ts` — single config file; edit here to switch chain/contract
- `src/abi.ts` — full typed ABI
- `src/components/` — Home, CreateCircle, CirclePage, MemberProfile
- `contracts/SavingsCircles.sol` — main contract
- `contracts/test/SavingsCircles.t.sol` — 16-test suite
- `docs/security-review-v2.md` — security review findings

## To Run

```bash
bun install
bun run dev
```
