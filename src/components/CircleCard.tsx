import { useReadContract } from 'wagmi';
import { SAVINGS_CIRCLES_ABI } from '../abi';
import { CONTRACT_ADDRESS, CHAIN_ID } from '../appConfig';
import { formatUsdc } from '../utils/format';
import { CircleState, stateName } from '../utils/contractHelpers';
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
    query: { enabled: !!CONTRACT_ADDRESS },
  });

  if (!data) return (
    <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 animate-pulse h-20" />
  );

  const [contribution, , size, memberCount, , , state, depositRounds] = data;
  const stateVal = Number(state);
  const stateColor =
    stateVal === (CircleState.Active as number) ? 'text-[var(--success)]' :
    stateVal === (CircleState.Finished as number) ? 'text-[var(--muted)]' :
    'text-[var(--accent)]';

  return (
    <button
      onClick={() => onClick(circleId)}
      className="w-full text-left rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 hover:border-[var(--border-strong)] transition-all flex items-center justify-between gap-3 group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">Circle #{String(circleId)}</span>
          <span className={`text-xs font-semibold ${stateColor}`}>{stateName(stateVal)}</span>
        </div>
        <p className="font-semibold text-[var(--ink)] tabular-nums">{formatUsdc(contribution)}/round</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-1"><Users size={11} />{Number(memberCount)}/{Number(size)}</span>
          <span>Deposit: {Number(depositRounds)} round{depositRounds !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <ChevronRight size={18} className="text-[var(--subtle)] group-hover:text-[var(--ink)] transition-colors shrink-0" />
    </button>
  );
}
