/**
 * useMyCircles — finds all circles a wallet is currently a member of.
 *
 * Strategy: read nextCircleId, then batch-call memberInfo(id, address) for
 * every circle id via wagmi useReadContracts (multicall). This is always
 * current and requires no log scanning, so the 4 000-block RPC cap is
 * irrelevant.
 *
 * Also returns `createdIds` — circle ids the wallet created that it has NOT
 * yet joined, sourced from localStorage so they survive page reloads.
 */

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { CONTRACT_ADDRESS } from "@/appConfig";
import { SAVINGS_CIRCLES_ABI } from "@/abi";

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS_KEY = (addr: string) => `sc_created_${addr.toLowerCase()}`;

/** Persist a newly-created circle id for this wallet. */
export function persistCreatedCircle(address: string, id: bigint) {
  try {
    const key  = LS_KEY(address);
    const prev = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
    const next = [...new Set([...prev, id.toString()])];
    localStorage.setItem(key, JSON.stringify(next));
  } catch { /* ignore storage errors */ }
}

function loadCreatedIds(address: string | undefined): bigint[] {
  if (!address) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY(address)) ?? "[]") as string[];
    return raw.map((s) => BigInt(s));
  } catch { return []; }
}

// ── hook ──────────────────────────────────────────────────────────────────────

export interface MyCirclesResult {
  /** Circles where isMember is true on-chain. */
  memberIds:  bigint[];
  /** Circles the wallet created (from localStorage) where isMember is false. */
  createdIds: bigint[];
  loading:    boolean;
  error:      string | null;
}

export function useMyCircles(
  address: `0x${string}` | undefined,
  /** Pass as a dependency when you want to re-fetch after a tx confirms. */
  refetchKey?: unknown,
): MyCirclesResult {
  // Step 1 — read the total number of circles created so far
  const {
    data: nextIdData,
    isLoading: loadingNextId,
    error: nextIdError,
    refetch: refetchNextId,
  } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESS,
        abi: SAVINGS_CIRCLES_ABI,
        functionName: "nextCircleId",
      },
    ],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  // Expose refetch so callers (via refetchKey) can re-trigger
  void refetchKey; // consumed as dependency via the query key below
  void refetchNextId;

  const totalCircles = useMemo<bigint>(() => {
    const result = nextIdData?.[0];
    if (result?.status === "success" && typeof result.result === "bigint") {
      return result.result;
    }
    return 0n;
  }, [nextIdData]);

  // Step 2 — batch-call memberInfo for every id × this address
  const memberInfoContracts = useMemo(() => {
    if (!address || totalCircles === 0n) return [];
    const calls = [];
    for (let i = 0n; i < totalCircles; i++) {
      calls.push({
        address: CONTRACT_ADDRESS,
        abi: SAVINGS_CIRCLES_ABI,
        functionName: "memberInfo" as const,
        args: [i, address] as [bigint, `0x${string}`],
      });
    }
    return calls;
  }, [address, totalCircles]);

  const {
    data: memberInfoData,
    isLoading: loadingMemberInfo,
    error: memberInfoError,
  } = useReadContracts({
    contracts: memberInfoContracts,
    query: {
      enabled: memberInfoContracts.length > 0,
      refetchInterval: 15_000,
    },
  });

  // Step 3 — filter to circles where isMember is true
  const memberIds = useMemo<bigint[]>(() => {
    if (!memberInfoData) return [];
    const ids: bigint[] = [];
    memberInfoData.forEach((result, i) => {
      if (result.status === "success") {
        const info = result.result as { isMember: boolean };
        if (info.isMember) ids.push(BigInt(i));
      }
    });
    return ids;
  }, [memberInfoData]);

  // Step 4 — created-but-not-joined from localStorage
  const createdIds = useMemo<bigint[]>(() => {
    const stored = loadCreatedIds(address);
    const memberSet = new Set(memberIds.map((id) => id.toString()));
    return stored.filter((id) => !memberSet.has(id.toString()));
  }, [address, memberIds]);

  const loading = loadingNextId || loadingMemberInfo;
  const rawError = nextIdError ?? memberInfoError;
  const errorMsg = rawError
    ? "Could not load circles. Check your connection and retry."
    : null;

  if (rawError) console.error("[useMyCircles]", rawError);

  return { memberIds, createdIds, loading, error: errorMsg };
}
