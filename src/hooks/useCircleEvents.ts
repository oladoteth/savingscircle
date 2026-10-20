import { useEffect, useState } from "react";
import { createPublicClient, http, parseAbiItem } from "viem";
import { CONTRACT_ADDRESS, CHAIN_ID, RPC_URL } from "@/appConfig";

const publicClient = createPublicClient({
  transport: http(RPC_URL),
  chain: { id: CHAIN_ID, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } },
});

export interface ActivityItem {
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
  kind:
    | "joined" | "left" | "removed" | "toppedUp"
    | "cycleStarted" | "collected" | "missed"
    | "payoutTaken" | "defaulted" | "cycleSettled" | "withdrawn";
  member?: string;
  amount?: bigint;
  lateCount?: bigint;
  cycle?: number;
  owedRemaining?: bigint;
  cycleStart?: bigint;
  memberCount?: bigint;
}

const EVENTS = [
  { kind: "joined"       as const, abi: parseAbiItem("event Joined(uint256 indexed id, address indexed member, uint256 memberCount)") },
  { kind: "left"         as const, abi: parseAbiItem("event Left(uint256 indexed id, address indexed member)") },
  { kind: "removed"      as const, abi: parseAbiItem("event Removed(uint256 indexed id, address indexed member)") },
  { kind: "toppedUp"     as const, abi: parseAbiItem("event ToppedUp(uint256 indexed id, address indexed member, uint256 amount)") },
  { kind: "cycleStarted" as const, abi: parseAbiItem("event CycleStarted(uint256 indexed id, uint32 cycle, uint64 cycleStart)") },
  { kind: "collected"    as const, abi: parseAbiItem("event Collected(uint256 indexed id, address indexed member, uint256 amount, uint256 lateCount)") },
  { kind: "missed"       as const, abi: parseAbiItem("event Missed(uint256 indexed id, address indexed member, uint256 owedRemaining)") },
  { kind: "payoutTaken"  as const, abi: parseAbiItem("event PayoutTaken(uint256 indexed id, uint32 cycle, address indexed member, uint256 payout)") },
  { kind: "defaulted"    as const, abi: parseAbiItem("event Defaulted(uint256 indexed id, address indexed member)") },
  { kind: "cycleSettled" as const, abi: parseAbiItem("event CycleSettled(uint256 indexed id, uint32 cycle)") },
  { kind: "withdrawn"    as const, abi: parseAbiItem("event Withdrawn(address indexed member, uint256 amount)") },
];

export function useCircleEvents(id: bigint | undefined): {
  events: ActivityItem[];
  loading: boolean;
} {
  const [events, setEvents] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (id === undefined || !CONTRACT_ADDRESS) return;

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const latest = await publicClient.getBlockNumber();
        const fromBlock = latest > 200_000n ? latest - 200_000n : 0n;

        const results = await Promise.all(
          EVENTS.map(({ abi }) =>
            publicClient.getLogs({
              address: CONTRACT_ADDRESS,
              event: abi,
              fromBlock,
            }).catch(() => [])
          )
        );

        const items: ActivityItem[] = [];
        results.forEach((logs, i) => {
          const kind = EVENTS[i].kind;
          for (const log of logs) {
            const a = log.args as Record<string, unknown>;
            // Only include events for this circle id
            if (a.id !== undefined && (a.id as bigint) !== id) continue;
            // withdrawn events don't have id — include all for address-level display
            items.push({
              blockNumber: log.blockNumber ?? 0n,
              logIndex:    log.logIndex ?? 0,
              txHash:      log.transactionHash ?? "",
              kind,
              member:       typeof a.member === "string" ? a.member : undefined,
              amount:       typeof a.amount === "bigint" ? a.amount : (typeof a.payout === "bigint" ? a.payout : undefined),
              lateCount:    typeof a.lateCount === "bigint" ? a.lateCount : undefined,
              cycle:        typeof a.cycle === "number" ? a.cycle : undefined,
              owedRemaining:typeof a.owedRemaining === "bigint" ? a.owedRemaining : undefined,
              cycleStart:   typeof a.cycleStart === "bigint" ? a.cycleStart : undefined,
              memberCount:  typeof a.memberCount === "bigint" ? a.memberCount : undefined,
            });
          }
        });

        items.sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) return Number(b.blockNumber - a.blockNumber);
          return b.logIndex - a.logIndex;
        });

        if (!cancelled) setEvents(items);
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    const timer = setInterval(() => { void run(); }, 15_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [id]);

  return { events, loading };
}
