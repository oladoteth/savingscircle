# Savings Circle

A permissionless on-demand ROSCA (ajo, tanda, susu) where the contract holds the money. Members save together on autopay. There is no fixed payout schedule: **each member can take the payout once per cycle, whenever they need it**, as long as they have zero arrears and the pot holds enough. Everyone pays the same contribution per period. A new cycle starts after settlement once all deposits are full.

## Deployed contract

| Network | Address | Notes |
|---|---|---|
| Arc Mainnet | [0x48E42a3FBc1672591290c7782D6E97B96C02AD69](https://explorer.arc.io/address/0x48E42a3FBc1672591290c7782D6E97B96C02AD69) | v2.2 — current |
| Arc Testnet | [0xaa433394d212a4d2257b634a6da214037db66b62](https://explorer.testnet.arc.io/address/0xaa433394d212a4d2257b634a6da214037db66b62) | v2.2 testnet — superseded by mainnet |

## Mainnet deployment

The production contract is deployed and source-verified on Arc Mainnet at commit `102a0f961`.

| Field | Value |
|---|---|
| Address | `0x48E42a3FBc1672591290c7782D6E97B96C02AD69` |
| Deploy tx | `0xb4c19ea02650239c8b3e0d0c7b76697e3f062926d133f62d50b69e1bd13f449b` |
| Deploy block | `27304433` |
| Constructor arg | `0x3600000000000000000000000000000000000000` (Arc USDC) |
| Explorer | [explorer.arc.io/address/0x48E42a3FBc1672591290c7782D6E97B96C02AD69](https://explorer.arc.io/address/0x48E42a3FBc1672591290c7782D6E97B96C02AD69) |

Deployed with Arc Foundry (`arc-forge`) from the `contracts/SavingsCircles.sol` source at that commit, with no code changes from the Arc Studio testnet build:

```bash
# Deploy
arc-forge create contracts/SavingsCircles.sol:SavingsCircles \
  --rpc-url https://rpc.mainnet.arc.io \
  --account arc-deployer \
  --broadcast \
  --constructor-args 0x3600000000000000000000000000000000000000

# Verify source
arc-forge verify-contract 0x48E42a3FBc1672591290c7782D6E97B96C02AD69 contracts/SavingsCircles.sol:SavingsCircles \
  --chain-id 5042 \
  --verifier sourcify \
  --constructor-args 0x0000000000000000000000003600000000000000000000000000000000000000
```

Sourcify returned an exact match and forwarded the verification to explorer.arc.io and arc.etherscan.io.

## Running the app

```bash
bun install
bun run dev
```

Open `http://localhost:5173` in your browser. Connect a wallet (MetaMask or any injected wallet). Use the **Get test USDC** button in the Arc Studio sidebar to get testnet USDC on Arc Testnet.

## Switching to Arc Mainnet

Edit **`src/appConfig.ts`** only — no other file needs to change:

```ts
export const CHAIN_ID = 5042;
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
export const CONTRACT_ADDRESS = '<your mainnet contract address>';
export const EXPLORER_BASE = 'https://explorer.arc.io';
export const RPC_URL = 'https://rpc.mainnet.arc.io';
export const CHAIN_NAME = 'Arc';
```

Then deploy a new `SavingsCircles` contract to Arc Mainnet passing `0x3600000000000000000000000000000000000000` as the constructor argument. Fill in the resulting address as `CONTRACT_ADDRESS`.

> **Warning:** mainnet uses real funds. Have the contract independently audited before deploying.

## How it works

### States
A circle is either **Pending** (forming or between cycles) or **Active** (cycle running).

### Forming (Pending)
1. **Create** — set contribution per period, period length (seconds; use minutes for demos, days for production), number of members (2–20), `depositPeriods` (1 to size−1), and an optional invite list.
2. **Join** — pay the deposit (`depositPeriods × contribution`). **Deposits stay locked for the life of the circle** — they are returned only when you call `leave()` or are removed after a default. They are NOT returned at cycle end.
3. **Leave** (Pending only) — credits your remaining deposit to `claimable` and removes you from the circle.
4. **TopUp** — if a previous cycle's settlement deducted from your deposit, top it back up to the full amount before the next cycle can start.
5. **Start cycle** — anyone can call `startCycle` once every slot is filled and every deposit is full.

### Running (Active)
- **Contributions are on autopay.** Anyone can call `collect(id)` at any time; it pulls as many whole contributions as each member's balance and allowance allow, up to what is owed. One member's transfer failure never reverts the call for others.
- **Manual pay.** Members can also call `pay(id)` to pay just their own owed amount.
- **Request payout.** Any member with zero arrears can call `request(id)` if `pot >= payout`. Each member may take the payout **once per cycle**; `takenThisCycle[member]` prevents double-claiming. Multiple members can each take one payout per cycle as the pot refills across periods.
- **Settle.** After `size × periodLength` seconds anyone can call `settleCycle(id)`. It:
  - Collects remaining owed amounts.
  - Deducts arrears from deposits. If a deposit can't cover them, the member **defaults** and is removed.
  - Pays out tier 1 (non-defaulters who haven't taken the payout) and then tier 2 (defaulters).
  - Returns to Pending.

### Withdraw
`withdraw()` transfers your entire `claimable` balance to you at any time.

## depositPeriods tradeoff

| depositPeriods | Deposit | Guarantee |
|---|---|---|
| 1 (minimum) | 1 × contribution | Low barrier; one missed period covered. Members who take early and stop paying will eventually default; the pot at settle may be short. |
| size−1 (maximum) | (size−1) × contribution | Any member who takes the payout in period 0 and never pays again has enough deposit to cover all remaining periods. Every other member still receives the full payout. |

## Reputation

Per-address counters: `cyclesCompleted`, `onTimePayments`, `latePayments`, `missedPayments`, `defaults`. A contribution pulled during the period it is due counts as on-time; one pulled for a prior period counts as late.

### Known limitation: reputation farming

On-chain reputation counters are not Sybil-resistant. A person controlling multiple wallets can build a record at low cost. Treat on-chain reputation as one signal alongside personal trust and social context.

## removeUnfunded

If a member's deposit was partially consumed by a settlement and they refuse to call `topUp`, any participant can call `removeUnfunded(id, member)` after at least one `periodLength` has elapsed since the last `settleCycle`. This credits the member's remaining deposit to `claimable` and removes them, unblocking the next cycle.

## Security review findings (v2 contract)

Four findings were identified; three fixed in this release:

| Severity | Finding | Status |
|---|---|---|
| Critical | `settleCycle` could strand USDC when all members took mid-cycle | Fixed |
| High | Multiple members taking payout per cycle | By design |
| High | Member could stall `startCycle` indefinitely | Fixed (`removeUnfunded`) |
| Medium | `join()` allowed joining a full circle | Fixed (`CircleFull` guard) |

See `docs/security-review-v2.md` for full details.

## Development

```bash
bun run contracts:build   # forge build
bun run contracts:test    # forge test (16 tests)
bun run check             # lint + typecheck
```
