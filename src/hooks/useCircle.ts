import { useReadContract, useReadContracts } from "wagmi";
import { SAVINGS_CIRCLES_ABI } from "@/abi";
import { CONTRACT_ADDRESS, CHAIN_ID } from "@/appConfig";
import { erc20Abi } from "viem";

const contract = { address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, chainId: CHAIN_ID } as const;

export function useCircle(id: bigint | undefined) {
  const idNum = id !== undefined ? id : 0n;
  const enabled = id !== undefined;

  const circle = useReadContract({
    ...contract,
    functionName: "getCircle",
    args: [idNum],
    query: { enabled, refetchInterval: 15_000 },
  });

  const members = useReadContract({
    ...contract,
    functionName: "getMembers",
    args: [idNum],
    query: { enabled, refetchInterval: 15_000 },
  });

  return { circle, members };
}

export function useMemberInfo(id: bigint | undefined, member: `0x${string}` | undefined) {
  return useReadContract({
    ...contract,
    functionName: "memberInfo",
    args: [id ?? 0n, member ?? "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: id !== undefined && !!member,
      refetchInterval: 15_000,
    },
  });
}

export function useAllMemberInfos(id: bigint | undefined, members: readonly `0x${string}`[]) {
  return useReadContracts({
    contracts: members.map((m) => ({
      ...contract,
      functionName: "memberInfo" as const,
      args: [id ?? 0n, m] as const,
    })),
    query: {
      enabled: id !== undefined && members.length > 0,
      refetchInterval: 15_000,
    },
  });
}

export function useClaimable(address: `0x${string}` | undefined) {
  return useReadContract({
    ...contract,
    functionName: "claimable",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
}

export function useReputation(address: `0x${string}` | undefined) {
  return useReadContract({
    ...contract,
    functionName: "reputation",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address },
  });
}

export function useUsdcBalance(address: `0x${string}` | undefined) {
  return useReadContract({
    address: "0x3600000000000000000000000000000000000000",
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
}

export function useUsdcAllowance(owner: `0x${string}` | undefined, spender: `0x${string}`) {
  return useReadContract({
    address: "0x3600000000000000000000000000000000000000",
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner ?? "0x0000000000000000000000000000000000000000", spender],
    chainId: CHAIN_ID,
    query: { enabled: !!owner, refetchInterval: 10_000 },
  });
}

export function useIsInvited(id: bigint | undefined, address: `0x${string}` | undefined) {
  return useReadContract({
    ...contract,
    functionName: "isInvited",
    args: [id ?? 0n, address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: id !== undefined && !!address },
  });
}
