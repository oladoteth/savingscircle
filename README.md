# SavingsCircles

A trustless rotating savings circle (ROSCA) on Arc. Known as ajo, tanda, or susu depending on where you grew up: a fixed group of people each contribute the same amount every round, and one member per round takes the whole pot, cycling through everyone until each person has received once.

This contract replaces the person who normally holds the money.

---

## How it works

1. Anyone calls `createCircle` to define a contribution amount, round length, group size, and deposit requirement.
2. Members `join` — each one locks up `depositRounds × contribution` as a deposit and joins the payout queue in join order.
3. Once the group is full the circle starts automatically. Each round, members call `contribute` before the deadline.
4. Anyone calls `closeRound` after the deadline. The contract tallies what was paid, handles missed payments from deposits, and credits the round's recipient.
5. Members call `withdraw` at any time to collect their claimable balance.

Payout is always pull-based. Transfers are never pushed to recipients — a blocklisted USDC address cannot freeze the circle for everyone else.

---

## Key parameters

| Parameter | Meaning |
|---|---|
| `contribution` | Amount each member pays per round (USDC, 6 decimals) |
| `roundLength` | Duration of each round in seconds |
| `size` | Number of members (2–20) |
| `depositRounds` | Number of rounds pre-funded as deposit at join time (1 to size−1) |
| `invited` | Optional whitelist of addresses allowed to join; pass `[]` for open circles |

### The depositRounds tradeoff

- **`depositRounds = 1`** — low barrier, trust-based. Members lock one round's worth. If someone defaults, the pot for that round is short.
- **`depositRounds = size − 1`** — maximum collateral. Each member pre-funds all rounds except their own recipient round. As long as no one exhausts their deposit, every later recipient gets the full pot even if an earlier recipient stops paying.

---

## Missed payments and defaults

- A non-recipient who misses has their deposit deducted to cover the shortfall. If the deposit covers it: `Missed` event, deposit reduced.
- If the deposit runs out: `Defaulted` event, remaining deposit goes to the pot, and a shortfall debt is recorded.
- When a defaulter later becomes the recipient, their pot repays their oldest debts first before crediting them the remainder.
- A recipient who misses their own round faces no deposit deduction — the pot is simply short by one contribution.

---

## Reputation

Each address accumulates `completedCircles`, `onTimePayments`, `missedPayments`, and `defaults` across all circles. Members who defaulted in a circle do not receive `completedCircles` credit for it.

> **Known limitation:** Reputation counters are not Sybil-resistant. A single person controlling multiple wallets can inflate their scores by running small circles between those wallets at low cost. Treat on-chain reputation as a weak signal and combine it with off-chain trust and social context.

---

## Contract interface

```solidity
// Create a circle
createCircle(uint256 contribution, uint64 roundLength, uint8 size, uint8 depositRounds, address[] calldata invited)
    returns (uint256 id)

// Join (locks depositRounds × contribution)
join(uint256 id)

// Leave before the circle starts (refunds deposit to claimable)
leave(uint256 id)

// Pay into the current round
contribute(uint256 id)

// Close the round after its deadline (permissionless)
closeRound(uint256 id)

// Collect claimable balance
withdraw()

// Views
getCircle(id)          // circle metadata + live pot
getMembers(id)         // member list in join order
hasPaid(id, round, member)
depositOf(id, member)
shortfallOf(id, member)
isInvited(id, member)
claimable(address)
reputation(address)
```

---

## Events

`CircleCreated`, `Joined`, `Left`, `CircleStarted`, `Contributed`, `Missed`, `Defaulted`, `RoundClosed`, `CircleFinished`, `Repaid`, `Withdrawn`

---

## Development

```bash
# Install dependencies
bun install

# Build contracts
bun run contracts:build   # forge build

# Run tests
bun run contracts:test    # forge test
```

Requires [Foundry](https://getfoundry.sh/). USDC address on Arc: `0x3600000000000000000000000000000000000000`.

---

## Security

- No owner, admin, pause, or upgrade path. No function can move funds except `withdraw()`, which only sends `claimable[msg.sender]` to `msg.sender`.
- `ReentrancyGuard` on all state-changing functions.
- `SafeERC20` for all token transfers.
- No `msg.value` or native balance usage anywhere.
- This code has not been professionally audited. Use at your own risk.
