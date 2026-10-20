import { usePublicClient } from 'wagmi';
import { useEffect, useState } from 'react';
import { CONTRACT_ADDRESS, CHAIN_ID } from '../appConfig';
import { SAVINGS_CIRCLES_ABI } from '../abi';

/**
 * Returns all circle IDs the given address is a member of,
 * derived from Joined events on the contract.
 */
export function useMyCircles(address: string | undefined): bigint[] {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const [circleIds, setCircleIds] = useState<bigint[]>([]);

  useEffect(() => {
    if (!client || !address || !CONTRACT_ADDRESS) return;
    let cancelled = false;

    async function fetch() {
      if (!client || !address) return;
      try {
        const blockNumber = await client.getBlockNumber();
        const from = blockNumber > 50000n ? blockNumber - 50000n : 0n;

        const { decodeEventLog } = await import('viem');
        const logs = await client.getLogs({
          address: CONTRACT_ADDRESS as `0x${string}`,
          fromBlock: from,
          toBlock: 'latest',
        });

        if (cancelled) return;

        const ids = new Set<string>();
        for (const log of logs) {
          try {
            const result = decodeEventLog({ abi: SAVINGS_CIRCLES_ABI, ...log }) as {
              eventName: string;
              args: Record<string, unknown>;
            };
            if (result.eventName === 'Joined' && String(result.args.member).toLowerCase() === address.toLowerCase()) {
              ids.add(String(result.args.id));
            }
          } catch {
            // skip
          }
        }

        setCircleIds(Array.from(ids).map(id => BigInt(id)).sort((a, b) => Number(a - b)));
      } catch {
        // ignore
      }
    }

    void fetch();
  }, [client, address]);

  return circleIds;
}
