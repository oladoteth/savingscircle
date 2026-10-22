/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, fallback, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arc.id, arc.rpcUrls.default.http[0])

// Fallback transport across all Arc mainnet RPC endpoints (rate-limit resilience)
const arcTransport = fallback(
  [...arc.rpcUrls.default.http].map((url) => http(url)),
  { rank: false },
)

export const config = createConfig({
  chains: [arc, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arc.id]: arcTransport,
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
