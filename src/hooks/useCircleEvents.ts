import { usePublicClient } from 'wagmi';
import { useEffect, useState } from 'react';
import { parseAbiItem, type Log } from 'viem';
import { CONTRACT_ADDRESS, CHAIN_ID } from '../appConfig';
import { SAVINGS_CIRCLES_ABI } from '../abi';
import { buildExplorerTxUrl } from '../utils/contractHelpers';
import { formatUsdc, shortAddr } from '../utils/format';

export interface ActivityEvent {
  id: string;
  text: string;
  txUrl: string;
  blockNumber: bigint;
}

const EVENTS = [
  'Joined(uint256 indexed id, address indexed member, uint256 memberCount)',
  'Left(uint256 indexed id, address indexed member)',
  'CircleStarted(uint256 indexed id, uint64 deadline)',
  'Contributed(uint256 indexed id, address indexed member, uint8 round)',
  'Missed(uint256 indexed id, address indexed member, uint8 round)',
  'Defaulted(uint256 indexed id, address indexed member, uint8 round)',
  'RoundClosed(uint256 indexed id, uint8 round, address indexed recipient, uint256 amount)',
  'CircleFinished(uint256 indexed id)',
  'Repaid(uint256 indexed id, address indexed debtor, address indexed creditor, uint256 amount)',
  'Withdrawn(address indexed member, uint256 amount)',
] as const;

function describeLog(log: Log & { eventName?: string; args?: Record<string, unknown> }): string | null {
  const { eventName, args } = log;
  if (!eventName || !args) return null;
  switch (eventName) {
    case 'Joined': return `${shortAddr(String(args.member))} joined (${String(args.memberCount)} members)`;
    case 'Left': return `${shortAddr(String(args.member))} left the circle`;
    case 'CircleStarted': return `Circle started`;
    case 'Contributed': return `${shortAddr(String(args.member))} paid round ${String(args.round)}`;
    case 'Missed': return `${shortAddr(String(args.member))} missed round ${String(args.round)}`;
    case 'Defaulted': return `${shortAddr(String(args.member))} defaulted round ${String(args.round)}`;
    case 'RoundClosed': return `Round ${String(args.round)} closed — ${shortAddr(String(args.recipient))} received ${formatUsdc(args.amount as bigint)}`;
    case 'CircleFinished': return `Circle finished`;
    case 'Repaid': return `${shortAddr(String(args.creditor))} repaid ${formatUsdc(args.amount as bigint)} from ${shortAddr(String(args.debtor))}'s pot`;
    case 'Withdrawn': return `${shortAddr(String(args.member))} withdrew ${formatUsdc(args.amount as bigint)}`;
    default: return null;
  }
}

export function useCircleEvents(circleId: bigint | undefined): ActivityEvent[] {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    if (!client || !circleId === undefined || !CONTRACT_ADDRESS) return;
    let cancelled = false;

    async function fetchEvents() {
      if (!client || circleId === undefined) return;
      try {
        const blockNumber = await client.getBlockNumber();
        const from = blockNumber > 10000n ? blockNumber - 10000n : 0n;

        const logs = await client.getLogs({
          address: CONTRACT_ADDRESS as `0x${string}`,
          fromBlock: from,
          toBlock: 'latest',
        });

        if (cancelled) return;

        // decode logs manually using the ABI
        const { decodeEventLog } = await import('viem');
        const decoded: ActivityEvent[] = [];
        for (const log of logs) {
          try {
            const result = decodeEventLog({ abi: SAVINGS_CIRCLES_ABI, ...log }) as {
              eventName: string;
              args: Record<string, unknown>;
            };
            // filter to the requested circle where possible
            const logId = result.args?.id as bigint | undefined;
            if (logId !== undefined && logId !== circleId) continue;

            const text = describeLog({ ...log, eventName: result.eventName, args: result.args });
            if (!text) continue;
            decoded.push({
              id: `${log.blockNumber}-${log.logIndex}`,
              text,
              txUrl: buildExplorerTxUrl(log.transactionHash ?? ''),
              blockNumber: log.blockNumber ?? 0n,
            });
          } catch {
            // skip undecodable logs
          }
        }
        decoded.sort((a, b) => Number(b.blockNumber - a.blockNumber));
        setEvents(decoded);
      } catch {
        // ignore fetch errors silently
      }
    }

    void fetchEvents();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, circleId]);

  return events;
}

// Parse event names for use with parseAbiItem (for type-safety)
void EVENTS;
void parseAbiItem; // keep import
