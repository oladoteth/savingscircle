import { ArrowLeft, ExternalLink, CheckCircle, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { useReputation } from '@/hooks/useCircle';
import { shortAddr, buildExplorerAddrUrl } from '@/utils/format';

interface Props {
  address: string;
  onNavigate: (path: string | number) => void;
}

const glass = {
  card: {
    background: 'var(--surface-strong)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid var(--border)',
    borderRadius: '1.5rem',
  } as React.CSSProperties,
};

interface StatProps { icon: React.ReactNode; label: string; value: string; accent?: string }
function StatCard({ icon, label, value, accent }: StatProps) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-1" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>{label}</span>
      </div>
      <span className="display text-3xl font-bold tabular-nums" style={{ color: accent ?? 'var(--ink)' }}>{value}</span>
    </div>
  );
}

export default function MemberProfile({ address: addr, onNavigate }: Props) {
  const { data: rep } = useReputation(addr as `0x${string}`);

  const [cyclesCompleted, onTimePayments, latePayments, missedPayments, defaults] = rep
    ? [Number(rep[0]), Number(rep[1]), Number(rep[2]), Number(rep[3]), Number(rep[4])]
    : [0, 0, 0, 0, 0];

  const totalPayments = onTimePayments + latePayments + missedPayments;
  const onTimePct = totalPayments > 0 ? Math.round((onTimePayments / totalPayments) * 100) : null;

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <div className="mx-auto max-w-md px-4 pt-6 pb-20">
        <button onClick={() => onNavigate(-1)} className="flex items-center gap-1.5 text-sm mb-5" style={{ color: 'var(--muted)' }}>
          <ArrowLeft className="size-4" /> Back
        </button>

        {/* Identity */}
        <section className="rounded-3xl p-5 mb-5" style={glass.card}>
          <div className="flex items-center gap-3 mb-3">
            <div className="size-12 rounded-2xl flex items-center justify-center text-base font-bold" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
              {addr.slice(2, 4).toUpperCase()}
            </div>
            <div>
              <p className="mono text-sm font-semibold" style={{ color: 'var(--ink)' }}>{shortAddr(addr)}</p>
              <a
                href={buildExplorerAddrUrl(addr)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs mt-0.5"
                style={{ color: 'var(--accent-hover)' }}
              >
                View on explorer <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
          <p className="text-xs text-pretty leading-relaxed" style={{ color: 'var(--muted)' }}>
            This savings record is public and portable. It belongs to the wallet, not to any app — a history a lender could accept.
          </p>
        </section>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <StatCard
            icon={<CheckCircle className="size-4" style={{ color: 'var(--success)' }} />}
            label="Cycles done"
            value={cyclesCompleted.toString()}
            accent="var(--success)"
          />
          <StatCard
            icon={<CheckCircle className="size-4" style={{ color: 'var(--success)' }} />}
            label="On time"
            value={onTimePct !== null ? `${onTimePct}%` : '—'}
            accent={onTimePct !== null && onTimePct >= 90 ? 'var(--success)' : 'var(--ink)'}
          />
          <StatCard
            icon={<Clock className="size-4" style={{ color: 'var(--accent)' }} />}
            label="Late payments"
            value={latePayments.toString()}
          />
          <StatCard
            icon={<AlertTriangle className="size-4" style={{ color: 'var(--danger)' }} />}
            label="Missed"
            value={missedPayments.toString()}
            accent={missedPayments > 0 ? 'var(--danger)' : 'var(--ink)'}
          />
        </div>

        {defaults > 0 && (
          <div className="rounded-2xl p-4 flex items-center gap-3 mb-4" style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.2)' }}>
            <XCircle className="size-5 shrink-0" style={{ color: 'var(--danger)' }} />
            <div>
              <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>Defaults: {defaults}</p>
              <p className="text-xs mt-0.5 text-pretty" style={{ color: 'var(--muted)' }}>
                This wallet was removed from a circle for missing payments without sufficient deposit cover.
              </p>
            </div>
          </div>
        )}

        {/* Full record */}
        <div className="rounded-2xl p-4 space-y-2" style={{ background: 'var(--surface-muted)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Full record</p>
          {[
            ['Cycles completed', cyclesCompleted],
            ['On-time payments', onTimePayments],
            ['Late payments', latePayments],
            ['Missed payments', missedPayments],
            ['Defaults', defaults],
          ].map(([label, val]) => (
            <div key={String(label)} className="flex justify-between text-xs">
              <span style={{ color: 'var(--muted)' }}>{label}</span>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>{val}</span>
            </div>
          ))}
        </div>

        <p className="text-xs mt-4 text-center text-pretty" style={{ color: 'var(--subtle)' }}>
          Reputation note: these numbers reflect on-chain activity and do not account for Sybil wallets. A high completion rate on a single wallet carries more weight when paired with a long on-chain history.
        </p>
      </div>
    </div>
  );
}
