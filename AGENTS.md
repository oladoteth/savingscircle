# SavingsCircles

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app.

---

## What This App Does

An on-demand ROSCA (ajo, tanda, susu) on Arc. Members save together with autopay contributions. There is no fixed payout schedule — each member can take the payout **once per cycle**, whenever they need it, provided they have zero arrears and the pot holds enough. Multiple members may each take one payout per cycle as the pot refills across periods. After settlement the circle returns to Pending for the next cycle.

## Deployed Contracts

| Contract | Network | Address | Notes |
|---|---|---|---|
| SavingsCircles v1 | Arc Testnet | [0xe4a39b29fee8942eafed5798105ae8982b0662f5](https://explorer.testnet.arc.io/address/0xe4a39b29fee8942eafed5798105ae8982b0662f5) | Old join-order model; superseded |
| SavingsCircles v2 | Arc Testnet | [0x74d6003369836212d5d8685082ab3e89b9809c2f](https://explorer.testnet.arc.io/address/0x74d6003369836212d5d8685082ab3e89b9809c2f) | On-demand model; live — tx 0x4394f9f362470a196a7bd3382c7be97fe9661318690546e94f7f215356c8a2b1 |

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
- `removeUnfunded(id, member)` — anyone, Pending only, after at least one `periodLength` elapsed since last `settleCycle` (`settledAt`). Removes a member whose deposit is below full; credits remaining deposit to `claimable`. Prevents one non-cooperative member stalling the circle indefinitely.

### Cycle mechanics

Periods: t = 0 to size−1. Contribution for period t is due at `cycleStart + t × periodLength`.

- `collect(id)` — pulls owed whole contributions for every member (try/catch, never reverts for callers). Late vs on-time classified per period boundary.
- `pay(id)` — same as collect but for `msg.sender` only.
- `request(id)` — member only, Active only. Runs collect first. Reverts: `AlreadyTaken`, `HasArrears`, `PotTooSmall`. Credits `claimable[msg.sender] += payout`, marks `takenThisCycle`. **Each member may call this once per cycle**; `takenThisCycle[member]` is the correct guard. Multiple members can take one payout each per cycle.
- `settleCycle(id)` — anyone, after `cycleStart + size × periodLength`. Collects remaining owed, deducts deposits (default if insufficient), pays tier1 (non-defaulters) then tier2 (defaulters), removes defaulters, resets per-cycle data, → Pending.

### Reputation per address

`cyclesCompleted`, `onTimePayments`, `latePayments`, `missedPayments`, `defaults`.

### Constructor

`constructor(address usdc_)` — Arc USDC: `0x3600000000000000000000000000000000000000`

### Tests

18 tests, all passing (`forge test`). Run with `bun run contracts:test`.

| # | Test function | Covers |
|---|---|---|
| 1 | `test_happyPath` | Full cycle, payouts out of join order, balance invariant |
| 2 | `test_requestReverts` | PotTooSmall, AlreadyTaken, HasArrears, NotMember, not Active |
| 3 | `test_emptyWalletThenLate` | Collect skips zero-balance; next collect pulls arrears as late |
| 4 | `test_revertingTokenSkippedInCollect` | Reverting token skipped; others succeed; invariant |
| 5 | `test_allowanceTooLow` | Low-allowance member skipped; others collected |
| 6 | `test_depositPeriodsSizeMinusOne_noDefault` | depositPeriods=size−1; Alice takes early, no default, Bob+Carol get full payout |
| 7 | `test_depositPeriods1_defaultAndRemoval` | depositPeriods=1; Alice defaults, Bob+Carol each get 250e6 (2.5 contributions) |
| 8 | `test_settleTooEarly` | TooEarlyToSettle revert; exact boundary succeeds |
| 9 | `test_secondCycle` | Leave+join+topUp between cycles; cyclesCompleted increments; invariant |
| 10a | `test_startCycleNotEnoughAndActiveReverts` | NotEnoughMembers; join/leave while Active revert |
| 10b | `test_depositNotFull` | DepositNotFull blocks startCycle; topUp restores it |
| 11 | `test_inviteList` | Uninvited revert; invited works; InviteListTooShort revert |
| 12 | `test_withdraw` | Exact amount; second call reverts NothingToWithdraw; invariant |
| 12b | `test_withdrawReentrancy` | Reentrant token cannot double-withdraw; invariant |
| 13a | `testFuzz_createCircleParams` | Valid params never revert; stored correctly |
| 13b | `testFuzz_balanceInvariant` | Random pay/miss patterns; pot==0 after settle; balance invariant |
| 14 | `test_circleFull` | CircleFull revert on full open circle; slot opens after leave |
| 15 | `test_removeUnfunded` | Grace period reverts; full-deposit revert; removal works; newcomer joins |

### Security review findings (v2, updated 2026-10-20)

Four findings total. Full report: `docs/security-review-v2.md`.

| Severity | Finding | Status |
|---|---|---|
| Critical | `settleCycle` could strand USDC when all members took mid-cycle | Fixed |
| High | Multiple members can take the payout in one cycle | By design |
| High | One member can stall `startCycle` indefinitely by refusing to `topUp` | Fixed (`removeUnfunded`) |
| Medium | `join()` allowed joining a full circle | Fixed (`CircleFull` guard) |

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
