/**
 * App-wide chain and contract configuration.
 *
 * To switch to Arc Mainnet, change ONLY the values in this file:
 *   CHAIN_ID       → 5042
 *   CONTRACT_ADDRESS → your mainnet contract address
 *   USDC_ADDRESS   → 0x3600000000000000000000000000000000000000  (same on mainnet)
 *   EXPLORER_BASE  → https://explorer.arc.io
 *   RPC_URL        → https://rpc.mainnet.arc.io
 *
 * Arc Testnet config (default):
 */

export const CHAIN_ID = 5042002;

/** Arc Testnet USDC (ERC-20, 6 decimals). Same address on Arc Mainnet. */
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;

export const USDC_DECIMALS = 6;

/** SavingsCircles on Arc Testnet — deployed 2026-10-16 */
export const CONTRACT_ADDRESS = '0xe4a39b29fee8942eafed5798105ae8982b0662f5' as const;

export const EXPLORER_BASE = 'https://explorer.testnet.arc.io';

export const RPC_URL = 'https://rpc.testnet.arc.io';

export const CHAIN_NAME = 'Arc Testnet';

/** Arc Mainnet settings (uncomment + delete the testnet block above to switch):
 *
 * export const CHAIN_ID = 5042;
 * export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
 * export const USDC_DECIMALS = 6;
 * export const CONTRACT_ADDRESS = '<your mainnet address>' as const;
 * export const EXPLORER_BASE = 'https://explorer.arc.io';
 * export const RPC_URL = 'https://rpc.mainnet.arc.io';
 * export const CHAIN_NAME = 'Arc';
 */
