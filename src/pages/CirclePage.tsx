import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { erc20Abi, parseUnits } from 'viem';
import { toast } from 'sonner';
import { ArrowLeft, Copy, ExternalLink, Clock, CheckCircle } from 'lucide-react';
import { SAVINGS_CIRCLES_ABI } from '../abi';
import { CONTRACT_ADDRESS, USDC_ADDRESS, CHAIN_ID, USDC_DECIMALS } from '../appConfig';
import { formatUsdc, shortAddr, formatCountdown, parseContractError } from '../utils/format';
import { CircleState, stateName, buildExplorerTxUrl } from '../utils/contractHelpers';
import { useCircleEvents } from '../hooks/useCircleEvents';

const CS = CircleState as unknown as Record<string, number>;

interface Props {
  circleId: bigint;
  onNavigate: (path: string | number) => void;
}

export default function CirclePage({ circleId, onNavigate }: Props) {
  const { address } = useAccount();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: circleData, refetch: refetchCircle } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAVINGS_CIRCLES_ABI,
    functionName: 'getCircle',
    args: [circleId],
    chainId: CHAIN_ID,
    query: { enabled: !!CONTRACT_ADDRESS },
  });

  const { data: membersRaw, refetch: refetchMembers } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAVINGS_CIRCLES_ABI,
    functionName: 'getMembers',
    args: [circleId],
    chainId: CHAIN_ID,
    query: { enabled: !!CONTRACT_ADDRESS },
  });

  const events = useCircleEvents(circleId);

  if (!circleData || !membersRaw) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: 'var(--bg-gradient)' }}>
        <div className="text-[var(--muted)] text-sm">Loading circle…</div>
      </div>
    );
  }

  const [contribution, , size, memberCount, currentRound, deadline, state, depositRounds, potForCurrentRound] = circleData;
  const members = membersRaw;
  const stateNum = Number(state);
  const deadlineNum = Number(deadline);
  const roundExpired = deadlineNum > 0 && now >= deadlineNum;
  const isMember = members.some(m => m.toLowerCase() === address?.toLowerCase());
  const isActive = stateNum === CS.Active;
  const isPending = stateNum === CS.Pending;
  const recipient = isActive ? members[Number(currentRound)] : null;

  function refetchAll() {
    void refetchCircle();
    void refetchMembers();
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-[var(--surface-strong)] backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate(-1)} className="p-1.5 rounded-lg hover:bg-[var(--surface-muted)] transition">
              <ArrowLeft size={18} className="text-[var(--ink)]" />
            </button>
            <div>
              <h1 className="display text-base font-bold text-[var(--ink)]">Circle #{String(circleId)}</h1>
              <span className={`text-xs font-semibold ${stateNum === CS.Active ? 'text-[var(--success)]' : stateNum === CS.Finished ? 'text-[var(--muted)]' : 'text-[var(--accent)]'}`}>
                {stateName(stateNum)}
              </span>
            </div>
          </div>
          <CopyLinkButton circleId={circleId} />
        </div>
      </header>

      <div className="flex-1 max-w-md mx-auto w-full px-4 py-5 flex flex-col gap-5">
        {/* Status card */}
        <div className="rounded-2xl bg-[var(--surface-strong)] border border-[var(--border)] p-5">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Contribution" value={formatUsdc(contribution)} />
            <Stat label="Pot size" value={formatUsdc((contribution) * BigInt(Number(size)))} />
            <Stat label="Members" value={`${Number(memberCount)}/${Number(size)}`} />
            <Stat label="Deposit cover" value={`${Number(depositRounds)} round${Number(depositRounds) !== 1 ? 's' : ''}`} />
          </div>

          {isPending && (
            <div className="mt-4 rounded-xl bg-[var(--surface-muted)] border border-[var(--border)] px-4 py-3">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted)]">Waiting for members</span>
                <span className="font-semibold tabular-nums text-[var(--ink)]">{Number(memberCount)}/{Number(size)} joined</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{ width: `${(Number(memberCount) / Number(size)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {isActive && deadline > 0n && (
            <div className="mt-4 rounded-xl bg-[var(--surface-muted)] border border-[var(--border)] px-4 py-3 flex justify-between items-center">
              <div>
                <p className="text-xs text-[var(--muted)] uppercase tracking-widest">Round {Number(currentRound) + 1}</p>
                <p className="font-semibold text-[var(--ink)] tabular-nums">{formatUsdc(potForCurrentRound)} collected</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-[var(--muted)] uppercase tracking-widest">
                  {roundExpired ? 'Expired' : 'Deadline'}
                </p>
                <p className={`font-semibold tabular-nums flex items-center gap-1 ${roundExpired ? 'text-[var(--danger)]' : 'text-[var(--ink)]'}`}>
                  <Clock size={13} />
                  {formatCountdown(deadlineNum)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Members payout order */}
        <section>
          <h2 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-2">Payout order</h2>
          <div className="flex flex-col gap-2">
            {members.map((m, i) => (
              <MemberRow
                key={m}
                address={m}
                index={i}
                circleId={circleId}
                currentRound={Number(currentRound)}
                state={stateNum}
                size={Number(size)}
                isCurrentUser={m.toLowerCase() === address?.toLowerCase()}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </section>

        {/* Actions */}
        {address && (
          <ActionPanel
            circleId={circleId}
            state={stateNum}
            isMember={isMember}
            address={address}
            contribution={contribution}
            depositRounds={Number(depositRounds)}
            currentRound={Number(currentRound)}
            roundExpired={roundExpired}
            recipient={recipient ?? undefined}
            refetch={refetchAll}
          />
        )}

        {/* Activity feed */}
        {events.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-2">Activity</h2>
            <div className="flex flex-col gap-2">
              {events.map(ev => (
                <div key={ev.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] px-4 py-3">
                  <p className="text-sm text-[var(--ink-2)]">{ev.text}</p>
                  {ev.txUrl && (
                    <a href={ev.txUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[var(--muted)] hover:text-[var(--ink)] transition">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)] uppercase tracking-widest">{label}</p>
      <p className="font-semibold tabular-nums text-[var(--ink)]">{value}</p>
    </div>
  );
}

function CopyLinkButton({ circleId }: { circleId: bigint }) {
  return (
    <button
      onClick={() => {
        const link = `${window.location.origin}${window.location.pathname}#/circle/${circleId}`;
        void navigator.clipboard.writeText(link).then(() => toast.success('Link copied!')).catch(() => toast.error('Could not copy'));
      }}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--border-strong)] transition"
    >
      <Copy size={12} /> Share
    </button>
  );
}

function MemberRow({
  address,
  index,
  circleId,
  currentRound,
  state,
  size,
  isCurrentUser,
  onNavigate,
}: {
  address: string;
  index: number;
  circleId: bigint;
  currentRound: number;
  state: number;
  size: number;
  isCurrentUser: boolean;
  onNavigate: (path: string | number) => void;
}) {
  const { data: deposit } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAVINGS_CIRCLES_ABI,
    functionName: 'depositOf',
    args: [circleId, address as `0x${string}`],
    chainId: CHAIN_ID,
    query: { enabled: !!CONTRACT_ADDRESS },
  });

  const isCurrentRecipient = state === CS.Active && index === currentRound;
  const hasPotted = state === CS.Active && index < currentRound;
  const isFinished = state === CS.Finished;

  return (
    <button
      onClick={() => onNavigate(`/member/${address}`)}
      className="flex items-center gap-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] px-4 py-3 hover:border-[var(--border-strong)] transition text-left group"
    >
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
        isCurrentRecipient ? 'bg-[var(--accent)] text-white' :
        hasPotted || isFinished ? 'bg-[var(--success)] text-white' :
        'bg-[var(--surface-muted)] text-[var(--muted)]'
      }`}>
        {hasPotted || (isFinished && index < size) ? <CheckCircle size={14} /> : <span className="text-xs font-bold">{index + 1}</span>}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold font-mono ${isCurrentUser ? 'text-[var(--accent)]' : 'text-[var(--ink)]'}`}>
          {shortAddr(address)}{isCurrentUser ? ' (you)' : ''}
        </p>
        {deposit !== undefined && (
          <p className="text-xs text-[var(--muted)]">Deposit: {formatUsdc(deposit)}</p>
        )}
      </div>

      {isCurrentRecipient && (
        <span className="text-xs font-semibold text-[var(--accent)] bg-[var(--surface-muted)] px-2 py-0.5 rounded-full">Receiving now</span>
      )}

      <ExternalLink size={13} className="text-[var(--subtle)] group-hover:text-[var(--muted)] shrink-0" />
    </button>
  );
}

// ── Action panel ───────────────────────────────────────────────────────────
interface ActionPanelProps {
  circleId: bigint;
  state: number;
  isMember: boolean;
  address: string;
  contribution: bigint;
  depositRounds: number;
  currentRound: number;
  roundExpired: boolean;
  recipient: string | undefined;
  refetch: () => void;
}

function ActionPanel({
  circleId, state, isMember, address, contribution, depositRounds,
  currentRound, roundExpired, refetch,
}: ActionPanelProps) {
  const { data: alreadyPaid, refetch: refetchPaid } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAVINGS_CIRCLES_ABI,
    functionName: 'hasPaid',
    args: [circleId, currentRound, address as `0x${string}`],
    chainId: CHAIN_ID,
    query: { enabled: !!CONTRACT_ADDRESS && state === CS.Active },
  });

  const { data: claimable, refetch: refetchClaimable } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAVINGS_CIRCLES_ABI,
    functionName: 'claimable',
    args: [address as `0x${string}`],
    chainId: CHAIN_ID,
    query: { enabled: !!CONTRACT_ADDRESS },
  });

  const depositAmount = contribution * BigInt(depositRounds);
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: CONTRACT_ADDRESS ? [address as `0x${string}`, CONTRACT_ADDRESS as `0x${string}`] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!CONTRACT_ADDRESS },
  });

  const { data: invited } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAVINGS_CIRCLES_ABI,
    functionName: 'isInvited',
    args: [circleId, address as `0x${string}`],
    chainId: CHAIN_ID,
    query: { enabled: !!CONTRACT_ADDRESS && state === CS.Pending && !isMember },
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>();
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({ hash: approveHash });

  function doJoin() {
    if (!CONTRACT_ADDRESS) return;
    writeContract(
      { address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'join', args: [circleId] },
      { onError(e) { toast.error(parseContractError(e)); setPendingAction(null); } }
    );
  }

  function doLeave() {
    if (!CONTRACT_ADDRESS) return;
    writeContract(
      { address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'leave', args: [circleId] },
      { onError(e) { toast.error(parseContractError(e)); setPendingAction(null); } }
    );
  }

  function doPay() {
    if (!CONTRACT_ADDRESS) return;
    writeContract(
      { address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'contribute', args: [circleId] },
      { onError(e) { toast.error(parseContractError(e)); setPendingAction(null); } }
    );
  }

  function doCloseRound() {
    if (!CONTRACT_ADDRESS) return;
    writeContract(
      { address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'closeRound', args: [circleId] },
      { onError(e) { toast.error(parseContractError(e)); setPendingAction(null); } }
    );
  }

  function doWithdraw() {
    if (!CONTRACT_ADDRESS) return;
    writeContract(
      { address: CONTRACT_ADDRESS, abi: SAVINGS_CIRCLES_ABI, functionName: 'withdraw', args: [] },
      { onError(e) { toast.error(parseContractError(e)); setPendingAction(null); } }
    );
  }

  function handleJoin() {
    setPendingAction('join');
    const needed = depositAmount;
    if (!allowance || (allowance) < needed) {
      writeContract(
        { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT_ADDRESS as `0x${string}`, parseUnits('1000000', USDC_DECIMALS)] },
        {
          onSuccess(h) { setApproveHash(h); },
          onError(e) { toast.error(parseContractError(e)); setPendingAction(null); },
        }
      );
    } else {
      doJoin();
    }
  }

  function handlePay() {
    setPendingAction('pay');
    if (!allowance || (allowance) < contribution) {
      writeContract(
        { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT_ADDRESS as `0x${string}`, parseUnits('1000000', USDC_DECIMALS)] },
        {
          onSuccess(h) { setApproveHash(h); },
          onError(e) { toast.error(parseContractError(e)); setPendingAction(null); },
        }
      );
    } else {
      doPay();
    }
  }

  if (isApproveSuccess && pendingAction === 'join') {
    void refetchAllowance();
    doJoin();
  }
  if (isApproveSuccess && pendingAction === 'pay') {
    void refetchAllowance();
    doPay();
  }

  if (isSuccess && hash) {
    refetch();
    void refetchPaid();
    void refetchClaimable();
    if (pendingAction === 'join') toast.success('Joined the circle!');
    if (pendingAction === 'leave') toast.success('Left the circle.');
    if (pendingAction === 'pay') toast.success('Payment confirmed!');
    if (pendingAction === 'close') toast.success('Round closed.');
    if (pendingAction === 'withdraw') toast.success('Withdrawn!');
    setPendingAction(null);
  }

  const isBusy = isPending || isConfirming || isApproveConfirming;
  const buttons: React.ReactNode[] = [];

  if (state === CS.Pending && !isMember && invited !== false) {
    buttons.push(
      <ActionBtn key="join" onClick={handleJoin} primary disabled={isBusy} loading={isBusy && pendingAction === 'join'}>
        Join — deposit {formatUsdc(depositAmount)}
      </ActionBtn>
    );
  }

  if (state === CS.Pending && isMember) {
    buttons.push(
      <ActionBtn key="leave" onClick={() => { setPendingAction('leave'); doLeave(); }} disabled={isBusy} loading={isBusy && pendingAction === 'leave'}>
        Leave circle
      </ActionBtn>
    );
  }

  if (state === CS.Active && isMember && !alreadyPaid && !roundExpired) {
    buttons.push(
      <ActionBtn key="pay" onClick={handlePay} primary disabled={isBusy} loading={isBusy && pendingAction === 'pay'}>
        Pay this round — {formatUsdc(contribution)}
      </ActionBtn>
    );
  }

  if (state === CS.Active && roundExpired) {
    buttons.push(
      <ActionBtn key="close" onClick={() => { setPendingAction('close'); doCloseRound(); }} disabled={isBusy} loading={isBusy && pendingAction === 'close'}>
        Close round
      </ActionBtn>
    );
  }

  if (claimable !== undefined && (claimable) > 0n) {
    buttons.push(
      <ActionBtn key="withdraw" onClick={() => { setPendingAction('withdraw'); doWithdraw(); }} primary disabled={isBusy} loading={isBusy && pendingAction === 'withdraw'}>
        Withdraw {formatUsdc(claimable)}
      </ActionBtn>
    );
  }

  if (buttons.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {hash && pendingAction === null && (
        <a href={buildExplorerTxUrl(hash)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--muted)] flex items-center gap-1 hover:underline">
          <ExternalLink size={11} /> Last transaction
        </a>
      )}
      {buttons}
    </div>
  );
}

function ActionBtn({
  children, onClick, primary, disabled, loading,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-4 rounded-2xl font-bold text-base transition disabled:opacity-50 ${
        primary
          ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
          : 'bg-[var(--surface-muted)] border border-[var(--border)] text-[var(--ink)] hover:border-[var(--border-strong)]'
      }`}
    >
      {loading ? 'Confirm in wallet…' : children}
    </button>
  );
}
