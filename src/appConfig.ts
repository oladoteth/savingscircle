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
export const CONTRACT_ADDRESS = "0xaa433394d212a4d2257b634a6da214037db66b62" as `0x${string}`;
// Block the current contract was deployed at — used as the log scan start point.
// Update this whenever the contract is redeployed.
export const DEPLOY_BLOCK    = 68_960_127n;

// ── Arc Mainnet (comment out Testnet block above and uncomment this) ──────────
// export const CHAIN_ID        = 5042;
// export const CHAIN_NAME      = "Arc";
// export const RPC_URL         = "https://rpc.mainnet.arc.io";
// export const EXPLORER_BASE   = "https://explorer.arc.io";
// export const USDC_ADDRESS    = "0x3600000000000000000000000000000000000000" as `0x${string}`;
// export const USDC_DECIMALS   = 6;
// export const CONTRACT_ADDRESS = "0x..." as `0x${string}`; // fill in after mainnet deploy
