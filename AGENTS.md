# SavingsCircles

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

A rotating savings circle (ROSCA — ajo, tanda, susu) on Arc. Members pool USDC every round; each round one member receives the full pot in join order until everyone has been paid once. The contract replaces the trusted third party who normally holds the money.

## Deployed Contracts

| Contract | Network | Address |
|---|---|---|
| SavingsCircles | — | not yet deployed |

## Contract: SavingsCircles (`contracts/SavingsCircles.sol`)

### Key design decisions

**depositRounds parameter:** Each circle specifies how many rounds of contributions each member must pre-deposit when joining. The join deposit is `depositRounds * contribution`. This is the core trust/collateral knob:

- `depositRounds = 1` (minimum): low-barrier trust-based circle. One-round deposit buffer. If a non-recipient member misses and their deposit is exhausted, that round's pot is short.
- `depositRounds = size - 1` (maximum): guaranteed-pot model. Every non-recipient who stops paying has enough deposit to cover all rounds they owe. As long as no member misses more rounds than `depositRounds`, every recipient gets a full pot. A member who received early and then defaults loses their entire pre-deposit to cover others' pots — they cannot profit from gaming the system without forfeiting more than they gained.

The tradeoff: higher `depositRounds` = stronger guarantees for recipients, but higher capital lockup for participants. `depositRounds = size - 1` is equivalent to requiring full pre-funding of all future obligations.

**Recipient-miss exemption in closeRound:** When the current round's recipient misses their own contribution, their deposit is NOT touched. The pot is simply short by one contribution. This prevents a pathological case where the recipient's deposit is consumed to pad their own payout — a value-neutral but confusing self-payment. Their deposit remains available to cover future rounds where they are a non-recipient.

**Pull-based payouts:** `closeRound` credits `claimable[recipient]` rather than pushing a transfer. This is essential on Arc because USDC transfers to blocklisted addresses revert — one bad address must never block the entire circle.

**Reputation system:** Per-address counters for `completedCircles`, `onTimePayments`, `missedPayments`, `defaults`. A `defaultedInCircle` flag per circle prevents double-counting defaults across rounds. Members who defaulted in a circle do not receive `completedCircles` credit.

### Constructor

`constructor(address usdc_)` — pass Arc USDC address: `0x3600000000000000000000000000000000000000`

### createCircle signature

`createCircle(uint256 contribution, uint64 roundLength, uint8 size, uint8 depositRounds, address[] calldata invited) returns (uint256 id)`

Constraints: contribution>0, roundLength>0, size in [2,20], depositRounds in [1, size-1]. If `invited` is non-empty, `invited.length >= size` is required. Pass an empty array for open circles.

### Other functions

- `leave(uint256 id)` — Pending-only, members only. Refunds deposit to claimable, removes member preserving order, emits Left.
- `isInvited(uint256 id, address member)` — returns true for open circles; checks invite list for restricted circles.
- `shortfallOf(uint256 id, address member)` — outstanding unpaid shortfall for a member in a circle.

### Tests

22 tests, all passing. Run with `bun run contracts:test` (`forge test`). Test file: `contracts/test/SavingsCircles.t.sol`.

Coverage: happy path, non-recipient miss with deposit coverage, double-default with short pot + repayment, all revert cases, withdraw reentrancy guard, reputation counters, two concurrent circles, depositRounds=size-1 guarantee, recipient-miss exemption, invalid depositRounds reverts, repayment waterfall (full and exact-debt), leave function, invite list.

### Known limitation: reputation farming

The on-chain reputation counters (`completedCircles`, `onTimePayments`, etc.) are not Sybil-resistant. A single person controlling multiple wallets can inflate their reputation by running small circles between those wallets at minimal cost. Treat on-chain reputation as a weak signal and combine it with off-chain trust and social context.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
