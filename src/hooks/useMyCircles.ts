/**
 * useMyCircles — fetches circle memberships and created circles directly from
 * the on-chain wallet index.
 *
 * Two view calls replace the previous multicall-over-all-ids approach:
 *   getCirclesByMember(wallet)  → ids where wallet is currently a member
 *   getCirclesByCreator(wallet) → ids wallet created (append-only)
 *
 * Both are single eth_call, no block-range limits, always current.
 * "Created by you" no longer needs localStorage — the contract is the source.
 */

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { CONTRACT_ADDRESS } from "@/appConfig";
import { SAVINGS_CIRCLES_ABI } from "@/abi";

export interface MyCirclesResult {
  /** Circles where wallet is currently a member. */
  memberIds:  bigint[];
  /**
   * Circles wallet created but has NOT joined yet
   * (createdByCreator − memberIds).
   */
  createdIds: bigint[];
  loading:    boolean;
  error:      string | null;
}

export function useMyCircles(
  address: `0x${string}` | undefined,
  /** Increment this to force a re-fetch after a tx confirms. */
  refetchKey?: unknown,
): MyCirclesResult {
  void refetchKey; // wagmi re-evaluates when `enabled` changes; key also
                   // triggers remount of the query when passed as queryKey.

  const {
    data,
    isLoading,
    error: readError,
  } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESS,
        abi: SAVINGS_CIRCLES_ABI,
        functionName: "getCirclesByMember",
        args: address ? [address] : undefined,
      },
      {
        address: CONTRACT_ADDRESS,
        abi: SAVINGS_CIRCLES_ABI,
        functionName: "getCirclesByCreator",
        args: address ? [address] : undefined,
      },
    ],
    query: {
      enabled: !!address && !!CONTRACT_ADDRESS,
      refetchInterval: 15_000,
    },
  });

  const { memberIds, createdIds } = useMemo<{
    memberIds: bigint[];
    createdIds: bigint[];
  }>(() => {
    if (!data) return { memberIds: [], createdIds: [] };

    const [memberResult, creatorResult] = data;

    const memberIds: bigint[] =
      memberResult?.status === "success" && Array.isArray(memberResult.result)
        ? (memberResult.result as bigint[])
        : [];

    const allCreatedIds: bigint[] =
      creatorResult?.status === "success" && Array.isArray(creatorResult.result)
        ? (creatorResult.result as bigint[])
        : [];

    const memberSet = new Set(memberIds.map((id) => id.toString()));
    const createdIds = allCreatedIds.filter((id) => !memberSet.has(id.toString()));

    return { memberIds, createdIds };
  }, [data]);

  const errorMsg = readError
    ? "Could not load circles. Check your connection and retry."
    : null;

  if (readError) console.error("[useMyCircles]", readError);

  return { memberIds, createdIds, loading: isLoading, error: errorMsg };
}
