/**
 * useCircleEvents — activity feed for a single circle.
 *
 * Fetches logs in 4 000-block chunks from DEPLOY_BLOCK to latest,
 * newest chunks first, so recent events appear immediately.
 * A "Load older" button triggers loading the next older chunk.
 *
 * Errors are surfaced (never swallowed silently) and logged to the console.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, http, parseAbiItem } from "viem";
import { CONTRACT_ADDRESS, CHAIN_ID, RPC_URL, DEPLOY_BLOCK } from "@/appConfig";

const publicClient = createPublicClient({
  transport: http(RPC_URL),
  chain: {
    id: CHAIN_ID,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
});

const CHUNK_SIZE = 4_000n;

export interface ActivityItem {
  blockNumber: bigint;
  logIndex:    number;
  txHash:      string;
  kind:
    | "joined" | "left" | "removed" | "toppedUp"
    | "cycleStarted" | "collected" | "missed"
    | "payoutTaken" | "defaulted" | "cycleSettled" | "withdrawn";
  member?:        string;
  amount?:        bigint;
  lateCount?:     bigint;
  cycle?:         number;
  owedRemaining?: bigint;
  cycleStart?:    bigint;
  memberCount?:   bigint;
}

const EVENT_DEFS = [
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

async function fetchChunk(id: bigint, fromBlock: bigint, toBlock: bigint): Promise<ActivityItem[]> {
  const results = await Promise.all(
    EVENT_DEFS.map(({ abi }) =>
      publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        event:   abi,
        fromBlock,
        toBlock,
      })
    )
  );

  const items: ActivityItem[] = [];
  results.forEach((logs, i) => {
    const kind = EVENT_DEFS[i].kind;
    for (const log of logs) {
      const a = log.args as Record<string, unknown>;
      if (a.id !== undefined && (a.id as bigint) !== id) continue;
      items.push({
        blockNumber:   log.blockNumber ?? 0n,
        logIndex:      log.logIndex ?? 0,
        txHash:        log.transactionHash ?? "",
        kind,
        member:        typeof a.member === "string" ? a.member : undefined,
        amount:        typeof a.amount === "bigint" ? a.amount : (typeof a.payout === "bigint" ? a.payout : undefined),
        lateCount:     typeof a.lateCount === "bigint" ? a.lateCount : undefined,
        cycle:         typeof a.cycle === "number" ? a.cycle : undefined,
        owedRemaining: typeof a.owedRemaining === "bigint" ? a.owedRemaining : undefined,
        cycleStart:    typeof a.cycleStart === "bigint" ? a.cycleStart : undefined,
        memberCount:   typeof a.memberCount === "bigint" ? a.memberCount : undefined,
      });
    }
  });

  items.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return Number(b.blockNumber - a.blockNumber);
    return b.logIndex - a.logIndex;
  });

  return items;
}

export interface UseCircleEventsResult {
  events:      ActivityItem[];
  loading:     boolean;
  loadingMore: boolean;
  hasMore:     boolean;
  error:       string | null;
  loadOlder:   () => Promise<void>;
  refresh:     () => Promise<void>;
}

export function useCircleEvents(id: bigint | undefined): UseCircleEventsResult {
  const [events,      setEvents]      = useState<ActivityItem[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // Track the oldest block fetched so "load older" knows where to start.
  // Mutated inside async callbacks only — never read during render.
  const oldestFetchedBlock = useRef<bigint | null>(null);

  // Initial load: fetch the most recent chunk (head − CHUNK_SIZE → head).
  const loadLatest = useCallback(async (circleId: bigint) => {
    setLoading(true);
    setError(null);
    try {
      const latest    = await publicClient.getBlockNumber();
      const fromBlock = latest > CHUNK_SIZE ? latest - CHUNK_SIZE : DEPLOY_BLOCK;
      const toBlock   = latest;
      const safeFrom  = fromBlock > DEPLOY_BLOCK ? fromBlock : DEPLOY_BLOCK;
      const items     = await fetchChunk(circleId, safeFrom, toBlock);
      oldestFetchedBlock.current = safeFrom;
      setEvents(items);
      setHasMore(safeFrom > DEPLOY_BLOCK);
    } catch (err) {
      console.error("[useCircleEvents] loadLatest", err);
      setError("Could not load activity. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOlder = useCallback(async () => {
    if (id === undefined || oldestFetchedBlock.current === null) return;
    if (oldestFetchedBlock.current <= DEPLOY_BLOCK) return;
    setLoadingMore(true);
    setError(null);
    try {
      const toBlock   = oldestFetchedBlock.current - 1n;
      const fromBlock = toBlock > CHUNK_SIZE ? toBlock - CHUNK_SIZE : DEPLOY_BLOCK;
      const items     = await fetchChunk(id, fromBlock, toBlock);
      oldestFetchedBlock.current = fromBlock;
      setHasMore(fromBlock > DEPLOY_BLOCK);
      setEvents((prev) => {
        // Merge and deduplicate by txHash+logIndex
        const seen = new Set(prev.map((e) => `${e.txHash}:${e.logIndex}`));
        const novel = items.filter((e) => !seen.has(`${e.txHash}:${e.logIndex}`));
        const merged = [...prev, ...novel];
        merged.sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) return Number(b.blockNumber - a.blockNumber);
          return b.logIndex - a.logIndex;
        });
        return merged;
      });
    } catch (err) {
      console.error("[useCircleEvents] loadOlder", err);
      setError("Could not load older activity. Check your connection and retry.");
    } finally {
      setLoadingMore(false);
    }
  }, [id]);

  // Refresh: re-fetch the latest chunk (does not discard older loaded pages).
  const refresh = useCallback(async () => {
    if (id === undefined) return;
    try {
      const latest    = await publicClient.getBlockNumber();
      const fromBlock = latest > CHUNK_SIZE ? latest - CHUNK_SIZE : DEPLOY_BLOCK;
      const items     = await fetchChunk(id, fromBlock > DEPLOY_BLOCK ? fromBlock : DEPLOY_BLOCK, latest);
      setEvents((prev) => {
        const seen  = new Set(items.map((e) => `${e.txHash}:${e.logIndex}`));
        const older = prev.filter((e) => !seen.has(`${e.txHash}:${e.logIndex}`) && e.blockNumber < fromBlock);
        const merged = [...items, ...older];
        merged.sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) return Number(b.blockNumber - a.blockNumber);
          return b.logIndex - a.logIndex;
        });
        return merged;
      });
    } catch (err) {
      console.error("[useCircleEvents] refresh", err);
    }
  }, [id]);

  useEffect(() => {
    if (id === undefined || !CONTRACT_ADDRESS) return;
    oldestFetchedBlock.current = null;
    // Schedule the async load after the current render cycle — satisfies the
    // React Compiler rule that effects must not call setState synchronously.
    const init = setTimeout(() => { void loadLatest(id); }, 0);
    const poll = setInterval(() => { void refresh(); }, 15_000);
    return () => { clearTimeout(init); clearInterval(poll); };
  }, [id, loadLatest, refresh]);

  return {
    events,
    loading,
    loadingMore,
    hasMore,
    error,
    loadOlder,
    refresh,
  };
}
