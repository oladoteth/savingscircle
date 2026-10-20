import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { Plus, ChevronRight } from 'lucide-react';
import { useUsdcBalance, useClaimable, useCircle } from '@/hooks/useCircle';
import { useMyCircles } from '@/hooks/useMyCircles';
import { useContractAction } from '@/hooks/useContractWrite';
import { formatUsdc } from '@/utils/format';
import { CONTRACT_ADDRESS, USDC_DECIMALS } from '@/appConfig';
import { SAVINGS_CIRCLES_ABI } from '@/abi';
import { TxButton } from '@/components/shared/TxButton';
import { ReceiptLink } from '@/components/shared/ReceiptLink';
import { ErrorMsg } from '@/components/shared/ErrorMsg';
import { WrongChainBanner } from '@/components/shared/WrongChainBanner';

const glass = {
  card: {
    background: 'var(--surface-strong)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid var(--border)',
    borderRadius: '1.5rem',
  } as React.CSSProperties,
};

interface Props { onNavigate: (path: string | number) => void }

function CircleRow({ id, onNavigate }: { id: bigint; onNavigate: (p: string | number) => void }) {
  const { circle: { data: c } } = useCircle(id);

  if (!c) return (
    <div className="h-14 rounded-2xl animate-pulse" style={{ background: 'var(--surface-muted)' }} />
  );

  const stateLabel = c.state === 0
    ? `Forming ${c.memberCount}/${c.size}`
    : `Cycle ${c.cycle} running`;

  const potPct = c.payout > 0n
    ? Math.min(100, Number((c.pot * 100n) / c.payout))
    : 0;

  return (
    <button
      onClick={() => onNavigate(`/circle/${id.toString()}`)}
      className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-lg" style={{
            background: c.state === 1 ? 'rgba(26,128,71,0.12)' : 'var(--surface-muted)',
            color: c.state === 1 ? 'var(--success)' : 'var(--muted)',
          }}>
            {stateLabel}
          </span>
          <span className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
            Payout {formatUsdc(c.payout)} USDC
          </span>
        </div>
        {c.state === 1 && (
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${potPct}%`, background: 'var(--success)' }} />
          </div>
        )}
      </div>
      <ChevronRight className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
    </button>
  );
}

export default function Home({ onNavigate }: Props) {
  const { address, chainId, isConnected } = useAccount();
  const { data: balance } = useUsdcBalance(address);
  const { data: claimableRaw } = useClaimable(address);
  const { circleIds, loading: circlesLoading } = useMyCircles(address);
  const { writeContract, hash, isPending, isConfirming, isSuccess, error, wrongChain, switchChain } = useContractAction();

  const lowBalance = balance !== undefined && balance < BigInt(Math.floor(0.05 * 10 ** USDC_DECIMALS));

  function handleWithdraw() {
    if (wrongChain) { switchChain({ chainId: 5042002 }); return; }
    writeContract({ address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'withdraw', args: [] });
  }

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <div className="mx-auto max-w-md px-4 pt-6 pb-20">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
              Savings Circles
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Save together, withdraw when you need it
            </p>
          </div>
          <ConnectKitButton />
        </div>

        <WrongChainBanner chainId={chainId} />

        {!isConnected ? (
          <div className="rounded-3xl p-8 text-center" style={glass.card}>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              Connect your wallet to see your circles and balances.
            </p>
            <ConnectKitButton />
          </div>
        ) : (
          <>
            {/* Balance card */}
            <section className="rounded-3xl p-5 mb-4" style={glass.card}>
              <p className="text-xs font-semibold mb-1 uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                USDC Balance
              </p>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="display text-4xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                  {balance !== undefined ? formatUsdc(balance) : '—'}
                </span>
                <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
              </div>
              {lowBalance && (
                <p className="text-xs mt-1 text-pretty" style={{ color: 'var(--muted)' }}>
                  Keep a little USDC for network fees. On Arc, fees are paid in USDC.
                </p>
              )}

              {claimableRaw !== undefined && claimableRaw > 0n && (
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                        Claimable
                      </p>
                      <p className="display text-2xl font-bold tabular-nums mt-0.5" style={{ color: 'var(--success)' }}>
                        {formatUsdc(claimableRaw)} USDC
                      </p>
                    </div>
                    <TxButton
                      label="Withdraw"
                      onClick={handleWithdraw}
                      isPending={isPending}
                      isConfirming={isConfirming}
                      size="sm"
                    />
                  </div>
                  <ReceiptLink hash={hash} isSuccess={isSuccess} />
                  <ErrorMsg error={error} />
                </div>
              )}
            </section>

            {/* My circles */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>My circles</h2>
            </div>

            {circlesLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-2xl animate-pulse" style={{ background: 'var(--surface-muted)' }} />
                ))}
              </div>
            ) : circleIds.length === 0 ? (
              <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--surface-muted)' }}>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  No circles yet. Create one or ask someone to share their circle link.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {circleIds.map((id) => (
                  <CircleRow key={id.toString()} id={id} onNavigate={onNavigate} />
                ))}
              </div>
            )}

            <button
              onClick={() => onNavigate('/create')}
              className="w-full mt-5 flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{ background: 'var(--accent)' }}
            >
              <Plus className="size-4" />
              Create a circle
            </button>
          </>
        )}
      </div>
    </div>
  );
}
