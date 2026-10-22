import { useState, useMemo } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useSwitchChain } from 'wagmi';
import { decodeEventLog } from 'viem';
import { ArrowLeft, Link as LinkIcon } from 'lucide-react';
import { SAVINGS_CIRCLES_ABI } from '@/abi';
import { CONTRACT_ADDRESS, CHAIN_ID } from '@/appConfig';
import { persistCreatedCircle } from '@/hooks/useMyCircles';
import { parseUsdc, formatUsdc } from '@/utils/format';
import { TxButton } from '@/components/shared/TxButton';
import { ErrorMsg } from '@/components/shared/ErrorMsg';
import { WrongChainBanner } from '@/components/shared/WrongChainBanner';

interface Props { onNavigate: (path: string | number) => void }

const glass = {
  card:  { background: 'var(--surface-strong)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid var(--border)', borderRadius: '1.5rem' } as React.CSSProperties,
  inner: { background: 'var(--surface-muted)', borderRadius: '1rem', padding: '1rem' } as React.CSSProperties,
};

const PERIOD_OPTIONS = [
  { label: '1 min',   value: 60      },
  { label: '3 min',   value: 180     },
  { label: '5 min',   value: 300     },
  { label: '1 day',   value: 86400   },
  { label: '7 days',  value: 604800  },
  { label: '30 days', value: 2592000 },
];

export default function CreateCircle({ onNavigate }: Props) {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const wrongChain = !!chainId && chainId !== CHAIN_ID;

  const [contribution, setContribution] = useState('10');
  const [periodSecs, setPeriodSecs]     = useState(180);
  const [size, setSize]                 = useState(3);
  const [depositPeriods, setDepositPeriods] = useState(2);
  const [inviteText, setInviteText]     = useState('');
  const [copied, setCopied]             = useState(false);

  const contribRaw = useMemo(() => parseUsdc(contribution), [contribution]);
  const payoutRaw  = useMemo(() => contribRaw * BigInt(size), [contribRaw, size]);
  const depositRaw = useMemo(() => contribRaw * BigInt(depositPeriods), [contribRaw, depositPeriods]);
  const inviteList = useMemo(
    () => inviteText.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.startsWith('0x') && s.length === 42) as `0x${string}`[],
    [inviteText],
  );

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  // Derive circle ID from receipt during render — avoids setState-in-effect pattern.
  // Also persist to localStorage so Home can show it under "Created by you".
  const derivedId = useMemo(() => {
    if (!isSuccess || !receipt || !address) return null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: SAVINGS_CIRCLES_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === 'CircleCreated') {
          const id = (decoded.args as { id: bigint }).id;
          persistCreatedCircle(address, id);
          return String(id);
        }
      } catch { /* skip */ }
    }
    return null;
  }, [isSuccess, receipt, address]);

  const effectiveCreatedId = derivedId;

  const canSubmit = contribRaw > 0n && size >= 2 && depositPeriods >= 1 && depositPeriods <= size - 1 && !!address;
  const inviteInvalid = inviteText.trim() !== '' && inviteList.length < size;

  function handleSubmit() {
    if (wrongChain) { switchChain({ chainId: CHAIN_ID }); return; }
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SAVINGS_CIRCLES_ABI,
      functionName: 'createCircle',
      args: [contribRaw, BigInt(periodSecs), size, depositPeriods, inviteList],
    });
  }

  const shareUrl = effectiveCreatedId ? `${window.location.origin}${window.location.pathname}#/circle/${effectiveCreatedId}` : null;

  function copyLink() {
    if (!shareUrl) return;
    void navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const maxGuarantees = depositPeriods === size - 1;

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <div className="mx-auto max-w-md px-4 pt-6 pb-20">
        <button onClick={() => onNavigate(-1)} className="flex items-center gap-1.5 text-sm mb-5" style={{ color: 'var(--muted)' }}>
          <ArrowLeft className="size-4" /> Back
        </button>

        <h1 className="display text-2xl font-bold mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          Create a circle
        </h1>
        <p className="text-sm mb-6 text-pretty" style={{ color: 'var(--muted)' }}>
          Everyone saves the same amount. Any member can take the payout when the pot is ready.
        </p>

        <WrongChainBanner chainId={chainId} />

        <div className="space-y-4">
          {/* Contribution */}
          <div style={glass.card} className="p-4">
            <label className="text-xs font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'var(--muted)' }}>
              Contribution per period
            </label>
            <div className="flex items-baseline gap-2" style={glass.inner}>
              <input
                inputMode="decimal"
                value={contribution}
                onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); setContribution(v); }}
                placeholder="10.00"
                className="display text-4xl font-bold tabular-nums bg-transparent outline-none w-full placeholder:text-slate-300"
                style={{ color: 'var(--ink)' }}
              />
              <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
            </div>
          </div>

          {/* Period length */}
          <div style={glass.card} className="p-4">
            <label className="text-xs font-semibold uppercase tracking-widest mb-3 block" style={{ color: 'var(--muted)' }}>
              Period length
            </label>
            <div className="flex flex-wrap gap-2">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPeriodSecs(opt.value)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: periodSecs === opt.value ? 'var(--accent)' : 'var(--surface-muted)',
                    color: periodSecs === opt.value ? '#fff' : 'var(--ink-2)',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Number of members */}
          <div style={glass.card} className="p-4">
            <label className="text-xs font-semibold uppercase tracking-widest mb-3 block" style={{ color: 'var(--muted)' }}>
              Number of members
            </label>
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  const n = Math.max(2, size - 1);
                  setSize(n);
                  if (depositPeriods > n - 1) setDepositPeriods(n - 1);
                }}
                className="size-9 rounded-xl flex items-center justify-center text-lg font-bold"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
              >−</button>
              <span className="display text-3xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{size}</span>
              <button
                onClick={() => setSize(Math.min(20, size + 1))}
                className="size-9 rounded-xl flex items-center justify-center text-lg font-bold"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
              >+</button>
            </div>
          </div>

          {/* Deposit cover */}
          <div style={glass.card} className="p-4">
            <label className="text-xs font-semibold uppercase tracking-widest mb-1 block" style={{ color: 'var(--muted)' }}>
              Deposit covers {depositPeriods} missed {depositPeriods === 1 ? 'period' : 'periods'}
            </label>
            <input
              type="range"
              min={1} max={size - 1} value={depositPeriods}
              onChange={(e) => setDepositPeriods(Number(e.target.value))}
              className="w-full mt-2"
              style={{ accentColor: 'var(--accent)' }}
            />
            <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--subtle)' }}>
              <span>Min (1)</span>
              <span>Max ({size - 1})</span>
            </div>
            {maxGuarantees && (
              <p className="mt-2 text-xs font-medium text-pretty" style={{ color: 'var(--success)' }}>
                Maximum deposit cover: even if one member takes the payout and stops paying, everyone else still receives the full payout.
              </p>
            )}
          </div>

          {/* Invite list */}
          <div style={glass.card} className="p-4">
            <label className="text-xs font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'var(--muted)' }}>
              Invite list (optional)
            </label>
            <textarea
              value={inviteText}
              onChange={(e) => setInviteText(e.target.value)}
              placeholder={'0xABC…\n0xDEF… (one address per line — must have at least as many as the member count)'}
              rows={3}
              className="w-full rounded-xl p-3 text-xs font-mono resize-none outline-none"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
            />
            {inviteText.trim() && inviteList.length < size && (
              <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>
                Need at least {size} valid addresses ({inviteList.length} so far).
              </p>
            )}
          </div>

          {/* Summary */}
          {contribRaw > 0n && (
            <div className="rounded-2xl p-4 space-y-1.5" style={{ background: 'var(--surface-muted)' }}>
              <SummaryRow label="Payout per request"    value={`${formatUsdc(payoutRaw)} USDC`} />
              <SummaryRow label="Join deposit"           value={`${formatUsdc(depositRaw)} USDC`} />
              <SummaryRow label="Invite list"            value={inviteList.length > 0 ? `${inviteList.length} addresses` : 'Open'} />
            </div>
          )}

          <ErrorMsg error={error} />

          <TxButton
            label="Create circle"
            onClick={handleSubmit}
            disabled={!canSubmit || inviteInvalid}
            isPending={isPending}
            isConfirming={isConfirming}
            fullWidth
          />

          {shareUrl && (
            <div className="rounded-2xl p-4" style={{ background: 'rgba(26,128,71,0.08)', border: '1px solid rgba(26,128,71,0.15)' }}>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--success)' }}>
                Circle created! Share this link to invite members.
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly value={shareUrl}
                  className="flex-1 text-xs rounded-xl px-3 py-2 outline-none font-mono truncate"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
                />
                <button
                  onClick={copyLink}
                  className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1 shrink-0"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  <LinkIcon className="size-3" />{copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button
                onClick={() => onNavigate(`/circle/${effectiveCreatedId}`)}
                className="mt-2 w-full text-xs font-semibold py-2 rounded-xl"
                style={{ background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--border)' }}
              >
                Open circle →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}
