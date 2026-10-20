import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { erc20Abi } from 'viem';
import { ArrowLeft, Link as LinkIcon, Users, ChevronRight } from 'lucide-react';
import { SAVINGS_CIRCLES_ABI } from '@/abi';
import { CONTRACT_ADDRESS, CHAIN_ID, USDC_ADDRESS } from '@/appConfig';
import { useCircle, useMemberInfo, useAllMemberInfos, useUsdcAllowance } from '@/hooks/useCircle';
import { useCircleEvents, ActivityItem } from '@/hooks/useCircleEvents';
import { formatUsdc, shortAddr, formatCountdown, formatPeriodLength, buildExplorerTxUrl, buildExplorerAddrUrl } from '@/utils/format';
import { TxButton } from '@/components/shared/TxButton';
import { ReceiptLink } from '@/components/shared/ReceiptLink';
import { ErrorMsg } from '@/components/shared/ErrorMsg';
import { WrongChainBanner } from '@/components/shared/WrongChainBanner';

interface Props {
  circleId: bigint;
  onNavigate: (path: string | number) => void;
}

const glass = {
  card:  { background: 'var(--surface-strong)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid var(--border)', borderRadius: '1.5rem' } as React.CSSProperties,
  inner: { background: 'var(--surface-muted)', borderRadius: '1rem' } as React.CSSProperties,
};

function getNowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

function useNow() {
  const [now, setNow] = useState(getNowSecs);
  useEffect(() => {
    const t = setInterval(() => setNow(getNowSecs()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function activityLabel(item: ActivityItem): string {
  switch (item.kind) {
    case 'joined':       return `${shortAddr(item.member ?? '')} joined`;
    case 'left':         return `${shortAddr(item.member ?? '')} left`;
    case 'removed':      return `${shortAddr(item.member ?? '')} removed`;
    case 'toppedUp':     return `${shortAddr(item.member ?? '')} topped up ${formatUsdc(item.amount)} USDC`;
    case 'cycleStarted': return `Cycle ${item.cycle} started`;
    case 'collected':    return `${shortAddr(item.member ?? '')} paid ${formatUsdc(item.amount)} USDC${item.lateCount && item.lateCount > 0n ? ' (late)' : ''}`;
    case 'missed':       return `${shortAddr(item.member ?? '')} missed — owes ${formatUsdc(item.owedRemaining)} USDC`;
    case 'payoutTaken':  return `${shortAddr(item.member ?? '')} took payout of ${formatUsdc(item.amount)} USDC`;
    case 'defaulted':    return `${shortAddr(item.member ?? '')} defaulted`;
    case 'cycleSettled': return `Cycle ${item.cycle} settled`;
    case 'withdrawn':    return `${shortAddr(item.member ?? '')} withdrew ${formatUsdc(item.amount)} USDC`;
  }
}

function activityColor(item: ActivityItem): string {
  if (item.kind === 'defaulted' || item.kind === 'missed') return 'var(--danger)';
  if (item.kind === 'payoutTaken' || item.kind === 'cycleSettled') return 'var(--success)';
  return 'var(--muted)';
}

/** Approve-then-call hook */
function useApproveFlow() {
  const { writeContract: approveW, data: approveHash, isPending: approvePending, error: approveErr, reset: resetApprove } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash });
  const { writeContract: actionW, data: actionHash, isPending: actionPending, error: actionErr, reset: resetAction } = useWriteContract();
  const { isLoading: actionConfirming, isSuccess: actionSuccess } = useWaitForTransactionReceipt({ hash: actionHash });

  return {
    approveW, approveHash, approvePending, approveConfirming, approveSuccess, approveErr, resetApprove,
    actionW, actionHash, actionPending, actionConfirming, actionSuccess, actionErr, resetAction,
    isPending: approvePending || actionPending,
    isConfirming: approveConfirming || actionConfirming,
    isSuccess: actionSuccess,
    error: approveErr ?? actionErr,
    hash: actionHash,
    reset: () => { resetApprove(); resetAction(); },
  };
}

export default function CirclePage({ circleId: id, onNavigate }: Props) {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const now = useNow();
  const [copied, setCopied] = useState(false);

  const { circle: { data: c, refetch: refetchCircle }, members: { data: members, refetch: refetchMembers } } = useCircle(id);
  const myInfoQ = useMemberInfo(id, address);
  const allInfos = useAllMemberInfos(id, (members ?? []));
  const { events, loading: eventsLoading } = useCircleEvents(id);
  const { data: allowance, refetch: refetchAllowance } = useUsdcAllowance(address, CONTRACT_ADDRESS);

  const wrongChain = !!chainId && chainId !== CHAIN_ID;

  const refetchAll = useCallback(() => {
    void refetchCircle();
    void refetchMembers();
    void myInfoQ.refetch();
    void refetchAllowance();
  }, [refetchCircle, refetchMembers, myInfoQ, refetchAllowance]);

  // Single write (collect, pay, request, settle, leave, startCycle, removeUnfunded, autopay approve)
  const { writeContract: singleW, data: singleHash, isPending: singlePending, error: singleErr, reset: singleReset } = useWriteContract();
  const { isLoading: singleConfirming, isSuccess: singleSuccess } = useWaitForTransactionReceipt({ hash: singleHash });
  useEffect(() => { if (singleSuccess) { refetchAll(); singleReset(); } }, [singleSuccess, refetchAll, singleReset]);

  // Join flow (approve then join)
  const joinF = useApproveFlow();
  useEffect(() => {
    if (joinF.approveSuccess && c) {
      joinF.actionW({ address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'join', args: [id] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinF.approveSuccess]);
  useEffect(() => { if (joinF.isSuccess) { refetchAll(); joinF.reset(); } }, [joinF.isSuccess, refetchAll, joinF.reset, joinF]); // eslint-disable-line react-hooks/exhaustive-deps

  // TopUp flow (approve then topUp)
  const topF = useApproveFlow();
  useEffect(() => {
    if (topF.approveSuccess && c) {
      topF.actionW({ address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'topUp', args: [id] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topF.approveSuccess]);
  useEffect(() => { if (topF.isSuccess) { refetchAll(); topF.reset(); } }, [topF.isSuccess, refetchAll, topF.reset, topF]); // eslint-disable-line react-hooks/exhaustive-deps

  function doSingle(fn: 'collect' | 'pay' | 'request' | 'settleCycle' | 'leave' | 'startCycle', extra?: unknown[]) {
    if (wrongChain) { switchChain({ chainId: CHAIN_ID }); return; }
    singleW({ address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: fn, args: ([id, ...(extra ?? [])]) as [bigint] });
  }

  function doRemove(member: `0x${string}`) {
    if (wrongChain) { switchChain({ chainId: CHAIN_ID }); return; }
    singleW({ address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'removeUnfunded', args: [id, member] });
  }

  function handleJoin() {
    if (!c) return;
    if (wrongChain) { switchChain({ chainId: CHAIN_ID }); return; }
    const depositAmt = c.contribution * BigInt(c.depositPeriods);
    if ((allowance ?? 0n) >= depositAmt) {
      joinF.actionW({ address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'join', args: [id] });
    } else {
      joinF.approveW({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT_ADDRESS, depositAmt] });
    }
  }

  function handleTopUp() {
    if (!c || !myInfoQ.data) return;
    if (wrongChain) { switchChain({ chainId: CHAIN_ID }); return; }
    const full = c.contribution * BigInt(c.depositPeriods);
    const needed = full - myInfoQ.data.deposit;
    if ((allowance ?? 0n) >= needed) {
      topF.actionW({ address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'topUp', args: [id] });
    } else {
      topF.approveW({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT_ADDRESS, needed] });
    }
  }

  function handleAutopay() {
    if (!c) return;
    if (wrongChain) { switchChain({ chainId: CHAIN_ID }); return; }
    const cycleNeeded = c.contribution * BigInt(c.size);
    const full = c.contribution * BigInt(c.depositPeriods);
    const depositGap = myInfoQ.data && full > myInfoQ.data.deposit ? full - myInfoQ.data.deposit : 0n;
    singleW({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT_ADDRESS, cycleNeeded + depositGap] });
  }

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#/circle/${id.toString()}`;
    void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  if (!c) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: 'var(--bg-gradient)' }}>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading circle…</p>
      </div>
    );
  }

  const isActive  = c.state === 1;
  const isPending = c.state === 0;
  const myInfo    = myInfoQ.data;
  const isMember  = myInfo?.isMember ?? false;
  const owedNow   = myInfo?.owedNow ?? 0n;
  const taken     = myInfo?.takenThisCycle ?? false;
  const myDeposit = myInfo?.deposit ?? 0n;
  const fullDeposit = c.contribution * BigInt(c.depositPeriods);
  const depositIsFull = myDeposit >= fullDeposit;
  const depositGap = depositIsFull ? 0n : fullDeposit - myDeposit;

  const potPct    = c.payout > 0n ? Math.min(100, Number((c.pot * 100n) / c.payout)) : 0;
  const settleTime = Number(c.cycleStart) + Number(c.size) * Number(c.periodLength);
  const canSettle = isActive && now >= settleTime && settleTime > 0;
  const nextDue   = Number(c.nextDueTime);
  const countdownSecs = nextDue > now ? nextDue - now : 0;

  const cycleNeeded = c.contribution * BigInt(c.size);
  const cycleAllowance = allowance ?? 0n;
  const paidSoFar = myInfo?.paidThisCycle ?? 0n;
  const remaining = cycleNeeded > paidSoFar ? cycleNeeded - paidSoFar : 0n;
  const autopayCoversRest = isActive && cycleAllowance >= remaining;

  const graceElapsed = Number(c.settledAt) > 0 && BigInt(now) >= c.settledAt + c.periodLength;

  const stateStr = isPending
    ? `Forming ${c.memberCount}/${c.size}`
    : `Cycle ${c.cycle} running — period ${Number(c.currentPeriod) + 1}/${c.size}`;

  const canRequest = isMember && isActive && !taken && owedNow === 0n && c.pot >= c.payout;

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <div className="mx-auto max-w-md px-4 pt-6 pb-24">
        {/* Nav */}
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => onNavigate('/')} className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted)' }}>
            <ArrowLeft className="size-4" /> Home
          </button>
          <button
            onClick={copyLink}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
          >
            <LinkIcon className="size-3" />{copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <WrongChainBanner chainId={chainId} />

        {/* Hero */}
        <section className="rounded-3xl p-5 mb-4" style={glass.card}>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-lg mb-3 inline-block" style={{
            background: isActive ? 'rgba(26,128,71,0.12)' : 'var(--surface-muted)',
            color: isActive ? 'var(--success)' : 'var(--muted)',
          }}>
            {stateStr}
          </span>

          <div className="flex items-baseline gap-1 mb-1">
            <span className="display text-4xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
              {formatUsdc(c.payout)}
            </span>
            <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC payout</span>
          </div>
          <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
            {formatUsdc(c.contribution)} USDC per {formatPeriodLength(Number(c.periodLength))} · {c.size} members
          </p>

          {/* Pot bar */}
          <div className="mb-2">
            <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--muted)' }}>
              <span>Pot: {formatUsdc(c.pot)} USDC</span>
              <span>Need {formatUsdc(c.payout)} USDC</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${potPct}%`, background: c.pot >= c.payout ? 'var(--success)' : 'var(--accent)' }}
              />
            </div>
            {c.pot >= c.payout && (
              <p className="text-xs font-semibold mt-1" style={{ color: 'var(--success)' }}>Payout available now</p>
            )}
          </div>

          {isActive && nextDue > 0 && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Next period due in{' '}
              <span className="font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>
                {formatCountdown(countdownSecs)}
              </span>
            </p>
          )}
        </section>

        {/* My actions */}
        {address && (
          <section className="rounded-2xl p-4 mb-4 space-y-3" style={glass.card}>
            <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>My actions</h3>

            {isMember && isActive && (
              <TxButton
                label="Request payout"
                onClick={() => doSingle('request')}
                disabled={!canRequest}
                disabledReason={
                  taken   ? 'You already took the payout this cycle.'
                  : owedNow > 0n ? `You owe ${formatUsdc(owedNow)} USDC — pay your share first.`
                  : c.pot < c.payout ? `Pot is ${formatUsdc(c.pot)} of ${formatUsdc(c.payout)} USDC.`
                  : undefined
                }
                isPending={singlePending}
                isConfirming={singleConfirming}
                fullWidth
              />
            )}

            {isMember && isActive && (
              <div className="p-3 rounded-2xl" style={glass.inner}>
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                      {autopayCoversRest ? 'Autopay active' : 'Turn on autopay'}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                      Allowance: {formatUsdc(cycleAllowance)} USDC
                    </p>
                    {!autopayCoversRest && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--danger)' }}>
                        Covers less than the rest of this cycle. Renew to stay on autopay.
                      </p>
                    )}
                  </div>
                  <TxButton
                    label={autopayCoversRest ? 'Renew' : 'Enable'}
                    onClick={handleAutopay}
                    size="sm"
                    variant={autopayCoversRest ? 'secondary' : 'primary'}
                    isPending={singlePending}
                    isConfirming={singleConfirming}
                  />
                </div>
              </div>
            )}

            {isMember && isActive && owedNow > 0n && (
              <TxButton
                label={`Pay ${formatUsdc(owedNow)} USDC now`}
                onClick={() => doSingle('pay')}
                isPending={singlePending}
                isConfirming={singleConfirming}
                variant="secondary"
                fullWidth
              />
            )}

            {isActive && (
              <TxButton
                label="Collect for everyone"
                onClick={() => doSingle('collect')}
                isPending={singlePending}
                isConfirming={singleConfirming}
                variant="secondary"
                fullWidth
              />
            )}

            {canSettle && (
              <TxButton
                label="Settle cycle"
                onClick={() => doSingle('settleCycle')}
                isPending={singlePending}
                isConfirming={singleConfirming}
                variant="secondary"
                fullWidth
              />
            )}

            {isPending && !isMember && (
              <TxButton
                label={`Join — deposit ${formatUsdc(c.contribution * BigInt(c.depositPeriods))} USDC`}
                onClick={handleJoin}
                isPending={joinF.isPending}
                isConfirming={joinF.isConfirming}
                fullWidth
              />
            )}
            {isPending && isMember && !depositIsFull && (
              <TxButton
                label={`Top up — ${formatUsdc(depositGap)} USDC needed`}
                onClick={handleTopUp}
                isPending={topF.isPending}
                isConfirming={topF.isConfirming}
                variant="secondary"
                fullWidth
              />
            )}
            {isPending && isMember && (
              <TxButton
                label="Leave circle"
                onClick={() => doSingle('leave')}
                isPending={singlePending}
                isConfirming={singleConfirming}
                variant="ghost"
                fullWidth
              />
            )}
            {isPending && Number(c.memberCount) === c.size && (
              <TxButton
                label="Start cycle"
                onClick={() => doSingle('startCycle')}
                isPending={singlePending}
                isConfirming={singleConfirming}
                variant="secondary"
                fullWidth
              />
            )}

            <ReceiptLink hash={singleHash ?? joinF.hash ?? topF.hash} isSuccess={singleSuccess || joinF.isSuccess || topF.isSuccess} />
            <ErrorMsg error={singleErr ?? joinF.error ?? topF.error} />
          </section>
        )}

        {/* Members */}
        <section className="mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
            Members ({String(c.memberCount)}/{c.size})
          </h3>
          <div className="space-y-2">
            {(members ?? []).map((m, i) => {
              const info = allInfos.data?.[i]?.result;
              const isMe = address && m.toLowerCase() === address.toLowerCase();
              const mDepFull = info ? info.deposit >= fullDeposit : false;
              const showRemove = isPending && graceElapsed && !!info && !mDepFull;

              return (
                <div key={m} className="rounded-2xl px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => onNavigate(`/member/${m}`)} className="flex items-center gap-2 min-w-0">
                      <div className="size-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
                        {m.slice(2, 4).toUpperCase()}
                      </div>
                      <div className="min-w-0 text-left">
                        <p className="text-sm font-semibold mono truncate" style={{ color: 'var(--ink)' }}>
                          {isMe ? 'You' : shortAddr(m)}
                        </p>
                        <a href={buildExplorerAddrUrl(m)} target="_blank" rel="noreferrer" className="text-xs" style={{ color: 'var(--subtle)' }}>
                          {shortAddr(m)}
                        </a>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      {info?.takenThisCycle && (
                        <span className="text-xs px-2 py-0.5 rounded-lg font-semibold" style={{ background: 'rgba(26,128,71,0.12)', color: 'var(--success)' }}>
                          Paid out
                        </span>
                      )}
                      {showRemove && (
                        <TxButton
                          label="Remove"
                          onClick={() => doRemove(m)}
                          size="sm"
                          variant="danger"
                          isPending={singlePending}
                          isConfirming={singleConfirming}
                        />
                      )}
                      <Users className="size-4" style={{ color: 'var(--subtle)' }} />
                    </div>
                  </div>
                  {info && (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                      <span>Deposit <span className="tabular-nums font-medium" style={{ color: 'var(--ink-2)' }}>{formatUsdc(info.deposit)} USDC</span></span>
                      {isActive && <span>Paid <span className="tabular-nums font-medium" style={{ color: 'var(--ink-2)' }}>{formatUsdc(info.paidThisCycle)} USDC</span></span>}
                      {isActive && info.owedNow > 0n && <span style={{ color: 'var(--danger)' }}>Owes <span className="tabular-nums font-medium">{formatUsdc(info.owedNow)} USDC</span></span>}
                      {isPending && !mDepFull && <span style={{ color: 'var(--danger)' }}>Deposit not full</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Activity */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>Activity</h3>
          {eventsLoading && events.length === 0 ? (
            <div className="h-10 rounded-2xl animate-pulse" style={{ background: 'var(--surface-muted)' }} />
          ) : events.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>No activity yet.</p>
          ) : (
            <div className="space-y-1">
              {events.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-2 py-2 px-3 rounded-xl" style={{ background: 'var(--surface)' }}>
                  <p className="text-xs" style={{ color: activityColor(item) }}>{activityLabel(item)}</p>
                  {item.txHash && (
                    <a href={buildExplorerTxUrl(item.txHash)} target="_blank" rel="noreferrer">
                      <ChevronRight className="size-3" style={{ color: 'var(--subtle)' }} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
