/**
 * useCircleEvents — activity feed for a single circle.
 *
 * Design:
 * - ONE eth_getLogs call per block range (no topic filter), decodes locally.
 * - Initial backfill: DEPLOY_BLOCK → latest in 2 000-block chunks, sequential,
 *   300 ms pause between chunks.
 * - After backfill: polls only new blocks (lastSeenBlock+1 → latest) every 15 s.
 * - Per-circle in-memory cache so switching pages doesn't re-scan history.
 * - 429/rate-limit: exponential back-off (2 s → 4 s → 8 s → 30 s max).
 *   Shows error only after 3 consecutive failures.
 * - Transport: viem fallback across all Arc mainnet RPC endpoints.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPublicClient,
  fallback,
  http,
  decodeEventLog,
  type AbiEvent,
  type Log,
} from "viem";
import { arc } from "viem/chains";
import { CONTRACT_ADDRESS, CHAIN_ID, DEPLOY_BLOCK } from "@/appConfig";
import { SAVINGS_CIRCLES_ABI } from "@/abi";

// ── Transport: fallback across all Arc RPC endpoints (viem chain definition) ──
const ARC_RPCS = [...arc.rpcUrls.default.http].map((url) => http(url));

const publicClient = createPublicClient({
  chain: { ...arc, id: CHAIN_ID },
  transport: fallback(ARC_RPCS, { rank: false }),
});

// ── In-memory event cache keyed by circle id ─────────────────────────────────
const eventCache = new Map<
  bigint,
  { items: ActivityItem[]; oldestBlock: bigint; latestBlock: bigint }
>();

// ── ABI event fragments extracted once ───────────────────────────────────────
const EVENT_ABIS = SAVINGS_CIRCLES_ABI.filter(
  (x) => x.type === "event"
) as AbiEvent[];

// ── Types ─────────────────────────────────────────────────────────────────────
export type EventKind =
  | "joined" | "left" | "removed" | "toppedUp"
  | "cycleStarted" | "collected" | "missed"
  | "payoutTaken" | "defaulted" | "cycleSettled" | "withdrawn";

export interface ActivityItem {
  blockNumber:    bigint;
  logIndex:       number;
  txHash:         string;
  kind:           EventKind;
  member?:        string;
  amount?:        bigint;
  lateCount?:     bigint;
  cycle?:         number;
  owedRemaining?: bigint;
  cycleStart?:    bigint;
  memberCount?:   bigint;
}

export interface UseCircleEventsResult {
  events:      ActivityItem[];
  loading:     boolean;
  loadingMore: boolean;
  hasMore:     boolean;
  error:       string | null;
  loadOlder:   () => void;
  refresh:     () => void;
}

// ── Event kind mapping (lowercase event name → EventKind) ────────────────────
const KIND_MAP: Record<string, EventKind> = {
  joined:       "joined",
  left:         "left",
  removed:      "removed",
  toppedUp:     "toppedUp",
  cyclestarted: "cycleStarted",
  collected:    "collected",
  missed:       "missed",
  payouttaken:  "payoutTaken",
  defaulted:    "defaulted",
  cyclesettled: "cycleSettled",
  withdrawn:    "withdrawn",
};

// ── Decode a raw log into ActivityItem | null ─────────────────────────────────
function decodeLog(log: Log, circleId: bigint): ActivityItem | null {
  if (!log.topics?.[0]) return null;
  for (const abi of EVENT_ABIS) {
    try {
      const decoded = decodeEventLog({ abi: [abi], data: log.data, topics: log.topics });
      const kind = KIND_MAP[(decoded.eventName).toLowerCase()];
      if (!kind) return null;
      const a = (decoded.args ?? {}) as Record<string, unknown>;
      // Filter by circle id for events that carry it
      if (a["id"] !== undefined && (a["id"] as bigint) !== circleId) return null;
      return {
        blockNumber:    log.blockNumber ?? 0n,
        logIndex:       log.logIndex ?? 0,
        txHash:         log.transactionHash ?? "",
        kind,
        member:         typeof a["member"] === "string" ? a["member"] : undefined,
        amount:         typeof a["amount"] === "bigint"
                          ? a["amount"]
                          : typeof a["payout"] === "bigint" ? a["payout"] : undefined,
        lateCount:      typeof a["lateCount"] === "bigint" ? a["lateCount"] : undefined,
        cycle:          typeof a["cycle"] === "number" ? a["cycle"]
                          : typeof a["cycle"] === "bigint" ? Number(a["cycle"]) : undefined,
        owedRemaining:  typeof a["owedRemaining"] === "bigint" ? a["owedRemaining"] : undefined,
        cycleStart:     typeof a["cycleStart"] === "bigint" ? a["cycleStart"] : undefined,
        memberCount:    typeof a["memberCount"] === "bigint" ? a["memberCount"] : undefined,
      };
    } catch {
      // not this event — try next
    }
  }
  return null;
}

// ── Sort descending (newest first) ───────────────────────────────────────────
function sortDesc(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return Number(b.blockNumber - a.blockNumber);
    return b.logIndex - a.logIndex;
  });
}

// ── Exponential back-off helper ───────────────────────────────────────────────
function backoffMs(attempt: number): number {
  return Math.min(2_000 * 2 ** attempt, 30_000);
}

const CHUNK = 2_000n;
const POLL_MS = 15_000;
const MAX_RETRIES = 3;
const BACKFILL_PAUSE_MS = 300;

// ── Fetch one block range (single getLogs, no topic filter) ───────────────────
async function fetchRange(
  circleId: bigint,
  fromBlock: bigint,
  toBlock: bigint,
  attempt = 0,
): Promise<ActivityItem[]> {
  try {
    const logs = await publicClient.getLogs({
      address: CONTRACT_ADDRESS,
      fromBlock,
      toBlock,
    });
    const items: ActivityItem[] = [];
    for (const log of logs) {
      const item = decodeLog(log, circleId);
      if (item) items.push(item);
    }
    return items;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const is429 = msg.includes("429") || msg.toLowerCase().includes("rate limit");
    if (is429 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      return fetchRange(circleId, fromBlock, toBlock, attempt + 1);
    }
    throw err;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useCircleEvents(id: bigint | undefined): UseCircleEventsResult {
  const [events,      setEvents]      = useState<ActivityItem[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // Refs mutated inside async callbacks only — never read during render.
  const latestSeenBlock    = useRef<bigint | null>(null);
  const oldestFetchedBlock = useRef<bigint | null>(null);
  const consecutiveFails   = useRef(0);
  const backfillDone       = useRef(false);

  // ── Merge items into state (deduplicate by txHash+logIndex) ────────────────
  function mergeItems(prev: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
    const seen = new Set(prev.map((e) => `${e.txHash}:${e.logIndex}`));
    const novel = incoming.filter((e) => !seen.has(`${e.txHash}:${e.logIndex}`));
    if (novel.length === 0) return prev;
    return sortDesc([...prev, ...novel]);
  }

  // ── Full backfill: sequential chunks from DEPLOY_BLOCK to head ─────────────
  const backfill = useCallback(async (circleId: bigint) => {
    setLoading(true);
    setError(null);
    consecutiveFails.current = 0;

    // Re-use cache if available
    const cached = eventCache.get(circleId);
    if (cached) {
      setEvents(cached.items);
      oldestFetchedBlock.current = cached.oldestBlock;
      latestSeenBlock.current    = cached.latestBlock;
      setHasMore(cached.oldestBlock > DEPLOY_BLOCK);
      setLoading(false);
      backfillDone.current = true;
      return;
    }

    try {
      const head = await publicClient.getBlockNumber();
      let from = DEPLOY_BLOCK;
      let allItems: ActivityItem[] = [];
      let firstChunk = true;

      while (from <= head) {
        const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
        try {
          const chunk = await fetchRange(circleId, from, to);
          allItems = [...allItems, ...chunk];
          if (firstChunk) {
            // Show first batch immediately so the feed isn't blank while loading
            setEvents(sortDesc([...allItems]));
            firstChunk = false;
          }
          consecutiveFails.current = 0;
        } catch (err) {
          consecutiveFails.current++;
          console.error(`[useCircleEvents] backfill chunk ${from}-${to}`, err);
          if (consecutiveFails.current >= MAX_RETRIES) {
            setError("Could not load activity. Check your connection and retry.");
            setLoading(false);
            return;
          }
        }
        from = to + 1n;
        if (from <= head) {
          await new Promise((r) => setTimeout(r, BACKFILL_PAUSE_MS));
        }
      }

      const sorted = sortDesc(allItems);
      oldestFetchedBlock.current = DEPLOY_BLOCK;
      latestSeenBlock.current    = head;
      setHasMore(false); // full history loaded
      setEvents(sorted);
      eventCache.set(circleId, {
        items:       sorted,
        oldestBlock: DEPLOY_BLOCK,
        latestBlock: head,
      });
      backfillDone.current = true;
    } catch (err) {
      console.error("[useCircleEvents] backfill", err);
      setError("Could not load activity. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Poll: fetch only new blocks since last seen ────────────────────────────
  const poll = useCallback(async (circleId: bigint) => {
    if (!backfillDone.current) return;
    const from = latestSeenBlock.current !== null
      ? latestSeenBlock.current + 1n
      : DEPLOY_BLOCK;

    try {
      const head = await publicClient.getBlockNumber();
      if (from > head) return; // nothing new
      const items = await fetchRange(circleId, from, head);
      latestSeenBlock.current = head;
      consecutiveFails.current = 0;

      if (items.length > 0) {
        setEvents((prev) => {
          const merged = mergeItems(prev, items);
          // Update cache
          const cached = eventCache.get(circleId);
          if (cached) {
            eventCache.set(circleId, {
              ...cached,
              items: merged,
              latestBlock: head,
            });
          }
          return merged;
        });
      }
    } catch (err) {
      consecutiveFails.current++;
      console.error("[useCircleEvents] poll", err);
      if (consecutiveFails.current >= MAX_RETRIES) {
        setError("Could not load activity. Check your connection and retry.");
      }
      // Don't surface earlier transient failures
    }
  }, []);

  // ── loadOlder: scan backwards before DEPLOY_BLOCK (historical pagination) ──
  // Full backfill always loads from DEPLOY_BLOCK so "load older" is a no-op
  // once the full scan completes. For the rare case the initial backfill was
  // cut short, this lets the user retry the missing window.
  const loadOlder = useCallback(() => {
    if (id === undefined) return;
    if (
      oldestFetchedBlock.current === null ||
      oldestFetchedBlock.current <= DEPLOY_BLOCK
    ) return;
    setLoadingMore(true);
    setError(null);

    const circleId = id;
    const toBlock   = oldestFetchedBlock.current - 1n;
    const fromBlock = toBlock > CHUNK ? toBlock - CHUNK : DEPLOY_BLOCK;

    fetchRange(circleId, fromBlock, toBlock)
      .then((items) => {
        oldestFetchedBlock.current = fromBlock;
        setHasMore(fromBlock > DEPLOY_BLOCK);
        setEvents((prev) => mergeItems(prev, items));
      })
      .catch((err) => {
        console.error("[useCircleEvents] loadOlder", err);
        setError("Could not load older activity. Check your connection and retry.");
      })
      .finally(() => setLoadingMore(false));
  }, [id]);

  // ── refresh: trigger a poll immediately ───────────────────────────────────
  const refresh = useCallback(() => {
    if (id === undefined) return;
    void poll(id);
  }, [id, poll]);

  // ── Mount / id-change effect ───────────────────────────────────────────────
  useEffect(() => {
    if (id === undefined || !CONTRACT_ADDRESS) return;
    backfillDone.current     = false;
    latestSeenBlock.current  = null;
    oldestFetchedBlock.current = null;
    consecutiveFails.current = 0;

    const init = setTimeout(() => { void backfill(id); }, 0);
    const interval = setInterval(() => { void poll(id); }, POLL_MS);
    return () => { clearTimeout(init); clearInterval(interval); };
  }, [id, backfill, poll]);

  return { events, loading, loadingMore, hasMore, error, loadOlder, refresh };
}
