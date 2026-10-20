import { useEffect, useState } from "react";
import { createPublicClient, http, parseAbiItem } from "viem";
import { CONTRACT_ADDRESS, CHAIN_ID, RPC_URL } from "@/appConfig";

const publicClient = createPublicClient({
  transport: http(RPC_URL),
  chain: { id: CHAIN_ID, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } },
});

const joinedAbi  = parseAbiItem("event Joined(uint256 indexed id, address indexed member, uint256 memberCount)");
const leftAbi    = parseAbiItem("event Left(uint256 indexed id, address indexed member)");
const removedAbi = parseAbiItem("event Removed(uint256 indexed id, address indexed member)");

export function useMyCircles(address: `0x${string}` | undefined): {
  circleIds: bigint[];
  loading: boolean;
} {
  const [circleIds, setCircleIds] = useState<bigint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address || !CONTRACT_ADDRESS) return;

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const latest = await publicClient.getBlockNumber();
        // Scan from up to 200k blocks ago (roughly a few days on Arc)
        const fromBlock = latest > 200_000n ? latest - 200_000n : 0n;

        const [joined, left, removed] = await Promise.all([
          publicClient.getLogs({ address: CONTRACT_ADDRESS, event: joinedAbi,  args: { member: address }, fromBlock }),
          publicClient.getLogs({ address: CONTRACT_ADDRESS, event: leftAbi,    args: { member: address }, fromBlock }),
          publicClient.getLogs({ address: CONTRACT_ADDRESS, event: removedAbi, args: { member: address }, fromBlock }),
        ]);

        const leftIds    = new Set(left.map((l)    => l.args.id as bigint));
        const removedIds = new Set(removed.map((r) => r.args.id as bigint));
        const active = [...new Set(joined.map((j) => j.args.id as bigint))]
          .filter((id) => !leftIds.has(id) && !removedIds.has(id));

        if (!cancelled) setCircleIds(active);
      } catch {
        // silently ignore — show empty list
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    const timer = setInterval(() => { void run(); }, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [address]);

  return { circleIds, loading };
}
