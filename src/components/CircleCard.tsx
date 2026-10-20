import { useReadContract } from 'wagmi';
import { SAVINGS_CIRCLES_ABI } from '../abi';
import { CONTRACT_ADDRESS, CHAIN_ID } from '../appConfig';
import { formatUsdc, formatPeriodLength } from '../utils/format';
import { Users, ChevronRight } from 'lucide-react';

interface Props {
  circleId: bigint;
  onClick: (id: bigint) => void;
}

export default function CircleCard({ circleId, onClick }: Props) {
  const { data } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAVINGS_CIRCLES_ABI,
    functionName: 'getCircle',
    args: [circleId],
    chainId: CHAIN_ID,
    query: { enabled: !!CONTRACT_ADDRESS, refetchInterval: 15_000 },
  });

  if (!data) return (
    <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 animate-pulse h-20" />
  );

  const { contribution, periodLength, size, memberCount, payout, state, cycle, pot } = data;
  const isActive = state === 1;
  const potPct = payout > 0n ? Math.min(100, Number((pot * 100n) / payout)) : 0;

  const stateLabel = isActive
    ? `Cycle ${cycle} running`
    : `Forming ${memberCount}/${size}`;

  return (
    <button
      onClick={() => onClick(circleId)}
      className="w-full text-left rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 hover:border-[var(--border-strong)] transition-all flex items-center justify-between gap-3 group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-lg" style={{
            background: isActive ? 'rgba(26,128,71,0.12)' : 'var(--surface-muted)',
            color: isActive ? 'var(--success)' : 'var(--muted)',
          }}>
            {stateLabel}
          </span>
        </div>
        <p className="font-semibold tabular-nums text-[var(--ink)]">
          {formatUsdc(contribution)} USDC / {formatPeriodLength(Number(periodLength))}
        </p>
        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-1"><Users size={11} /> {String(memberCount)}/{size}</span>
          <span>Payout {formatUsdc(payout)} USDC</span>
        </div>
        {isActive && (
          <div className="mt-2 h-1 rounded-full overflow-hidden bg-[var(--surface-muted)]">
            <div className="h-full rounded-full" style={{ width: `${potPct}%`, background: 'var(--success)' }} />
          </div>
        )}
      </div>
      <ChevronRight size={18} className="text-[var(--subtle)] group-hover:text-[var(--ink)] transition-colors shrink-0" />
    </button>
  );
}
