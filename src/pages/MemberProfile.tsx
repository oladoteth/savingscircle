import { useReadContract } from 'wagmi';
import { ArrowLeft, ExternalLink, CheckCircle, Clock, AlertTriangle, ShieldOff } from 'lucide-react';
import { SAVINGS_CIRCLES_ABI } from '../abi';
import { CONTRACT_ADDRESS, CHAIN_ID } from '../appConfig';
import { shortAddr } from '../utils/format';
import { buildExplorerAddrUrl } from '../utils/contractHelpers';

interface Props {
  address: string;
  onNavigate: (path: string | number) => void;
}

export default function MemberProfile({ address, onNavigate }: Props) {
  const { data: rep } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAVINGS_CIRCLES_ABI,
    functionName: 'reputation',
    args: [address as `0x${string}`],
    chainId: CHAIN_ID,
    query: { enabled: !!CONTRACT_ADDRESS },
  });

  const repTuple = rep;
  const [completedCircles, onTimePayments, missedPayments, defaults] = repTuple ?? [0n, 0n, 0n, 0n];

  const total = (onTimePayments) + (missedPayments);
  const onTimeRate = total > 0n ? Math.round(Number((onTimePayments) * 100n / (total))) : null;

  const scoreColor =
    onTimeRate === null ? 'text-[var(--muted)]' :
    onTimeRate >= 90 ? 'text-[var(--success)]' :
    onTimeRate >= 70 ? 'text-yellow-600' :
    'text-[var(--danger)]';

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-[var(--surface-strong)] backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => onNavigate(-1)} className="p-1.5 rounded-lg hover:bg-[var(--surface-muted)] transition">
            <ArrowLeft size={18} className="text-[var(--ink)]" />
          </button>
          <h1 className="display text-base font-bold text-[var(--ink)]">Savings Record</h1>
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 flex flex-col gap-5">
        {/* Identity card */}
        <div className="rounded-3xl bg-[var(--surface-strong)] border border-[var(--border)] p-6 flex flex-col items-center gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full bg-[var(--accent)] flex items-center justify-center">
            <span className="display text-2xl font-bold text-white">
              {address.slice(2, 4).toUpperCase()}
            </span>
          </div>

          <div className="text-center">
            <p className="font-mono text-sm text-[var(--ink-2)] mb-1">{shortAddr(address)}</p>
            <a
              href={buildExplorerAddrUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--muted)] flex items-center justify-center gap-1 hover:underline"
            >
              View on explorer <ExternalLink size={11} />
            </a>
          </div>

          {/* Score */}
          {onTimeRate !== null && (
            <div className={`text-center ${scoreColor}`}>
              <p className={`display text-4xl font-bold tabular-nums`} style={{ letterSpacing: '-0.03em' }}>
                {onTimeRate}%
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5">on-time payment rate</p>
            </div>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<CheckCircle size={18} className="text-[var(--success)]" />}
            label="Circles completed"
            value={String(completedCircles)}
          />
          <StatCard
            icon={<Clock size={18} className="text-[var(--accent)]" />}
            label="On-time payments"
            value={String(onTimePayments)}
          />
          <StatCard
            icon={<AlertTriangle size={18} className="text-yellow-500" />}
            label="Missed payments"
            value={String(missedPayments)}
          />
          <StatCard
            icon={<ShieldOff size={18} className="text-[var(--danger)]" />}
            label="Defaults"
            value={String(defaults)}
          />
        </div>

        {/* What this means */}
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
          <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-2">What is this?</h3>
          <p className="text-sm text-[var(--ink-2)] text-pretty leading-relaxed">
            This record is stored publicly on-chain and cannot be altered. It shows how reliably this address has participated in savings circles — useful for deciding who to invite to your next circle.
          </p>
          <p className="text-xs text-[var(--muted)] mt-3 text-pretty">
            Note: on-chain reputation is not Sybil-resistant. A person controlling many wallets can build a record at low cost. Use it as one signal alongside personal trust.
          </p>
        </div>

        {/* Full address */}
        <div>
          <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">Full address</p>
          <div
            className="rounded-xl bg-[var(--surface-muted)] border border-[var(--border)] px-4 py-3 font-mono text-xs text-[var(--ink-2)] break-all select-all cursor-pointer"
            onClick={() => { void navigator.clipboard.writeText(address); }}
            title="Click to copy"
          >
            {address}
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
      <div className="flex items-center gap-2 mb-2">{icon}</div>
      <p className="text-2xl font-bold tabular-nums text-[var(--ink)] display" style={{ letterSpacing: '-0.02em' }}>{value}</p>
      <p className="text-xs text-[var(--muted)] mt-0.5">{label}</p>
    </div>
  );
}
