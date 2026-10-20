/**
 * SavingsCircles app configuration.
 * Change ONLY this file to switch between Arc Testnet and Arc Mainnet.
 *
 * Arc Testnet  → use the values already set below.
 * Arc Mainnet  → uncomment the mainnet block and comment out the testnet block.
 */

// ── Arc Testnet ───────────────────────────────────────────────────────────────
export const CHAIN_ID        = 5042002;
export const CHAIN_NAME      = "Arc Testnet";
export const RPC_URL         = "https://rpc.testnet.arc.io";
export const EXPLORER_BASE   = "https://explorer.testnet.arc.io";
export const USDC_ADDRESS    = "0x3600000000000000000000000000000000000000" as `0x${string}`;
export const USDC_DECIMALS   = 6;
export const CONTRACT_ADDRESS = "0x74d6003369836212d5d8685082ab3e89b9809c2f" as `0x${string}`;

// ── Arc Mainnet (comment out Testnet block above and uncomment this) ──────────
// export const CHAIN_ID        = 5042;
// export const CHAIN_NAME      = "Arc";
// export const RPC_URL         = "https://rpc.mainnet.arc.io";
// export const EXPLORER_BASE   = "https://explorer.arc.io";
// export const USDC_ADDRESS    = "0x3600000000000000000000000000000000000000" as `0x${string}`;
// export const USDC_DECIMALS   = 6;
// export const CONTRACT_ADDRESS = "0x..." as `0x${string}`; // fill in after mainnet deploy
