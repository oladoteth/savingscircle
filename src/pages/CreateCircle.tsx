import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, usePublicClient } from 'wagmi';
import { erc20Abi, parseUnits } from 'viem';
import { toast } from 'sonner';
import { ArrowLeft, Plus, X, ExternalLink } from 'lucide-react';
import { SAVINGS_CIRCLES_ABI } from '../abi';
import { CONTRACT_ADDRESS, USDC_ADDRESS, CHAIN_ID, USDC_DECIMALS } from '../appConfig';
import { parseContractError, parseUsdc, formatUsdc } from '../utils/format';
import { buildExplorerTxUrl } from '../utils/contractHelpers';
import { isAddress } from 'viem';

interface Props {
  onNavigate: (path: string | number) => void;
}

export default function CreateCircle({ onNavigate }: Props) {
  const { address } = useAccount();

  const [contribution, setContribution] = useState('');
  const [roundLengthValue, setRoundLengthValue] = useState('7');
  const [roundLengthUnit, setRoundLengthUnit] = useState<'minutes' | 'days'>('days');
  const [size, setSize] = useState('3');
  const [depositRounds, setDepositRounds] = useState('1');
  const [inviteInput, setInviteInput] = useState('');
  const [inviteList, setInviteList] = useState<string[]>([]);
  const [createdCircleId, setCreatedCircleId] = useState<bigint | null>(null);
  const [step, setStep] = useState<'form' | 'approving' | 'creating' | 'done'>('form');

  const sizeNum = Math.min(20, Math.max(2, parseInt(size) || 2));
  const depositRoundsNum = Math.min(sizeNum - 1, Math.max(1, parseInt(depositRounds) || 1));
  const contributionRaw = parseUsdc(contribution);
  const depositAmount = contributionRaw !== undefined ? contributionRaw * BigInt(depositRoundsNum) : undefined;
  const roundLengthSecs = BigInt(
    roundLengthUnit === 'minutes'
      ? Math.max(1, parseInt(roundLengthValue) || 1) * 60
      : Math.max(1, parseInt(roundLengthValue) || 1) * 86400
  );

  // Check current allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && CONTRACT_ADDRESS ? [address, CONTRACT_ADDRESS as `0x${string}`] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!CONTRACT_ADDRESS },
  });

  // Approve tx
  const { writeContract: approve, data: approveHash, isPending: isApprovePending } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({ hash: approveHash });

  // Create tx
  const { writeContract: createCircle, data: createHash, isPending: isCreatePending } = useWriteContract();
  const { isLoading: isCreateConfirming, isSuccess: isCreateSuccess } = useWaitForTransactionReceipt({ hash: createHash });

  const client = usePublicClient({ chainId: CHAIN_ID });

  // When approve succeeds, proceed to create
  if (isApproveSuccess && step === 'approving') {
    void refetchAllowance();
    doCreate();
  }

  function doCreate() {
    if (!contributionRaw || !CONTRACT_ADDRESS) return;
    setStep('creating');
    createCircle(
      {
        address: CONTRACT_ADDRESS,
        abi: SAVINGS_CIRCLES_ABI,
        functionName: 'createCircle',
        args: [
          contributionRaw,
          roundLengthSecs,
          sizeNum,
          depositRoundsNum,
          inviteList.length > 0 ? inviteList as `0x${string}`[] : [],
        ],
      },
      {
        onError(e) {
          toast.error(parseContractError(e));
          setStep('form');
        },
      }
    );
  }

  // When create succeeds, get the circle ID from the event
  if (isCreateSuccess && createHash && step === 'creating') {
    setStep('done');
    // Parse CircleCreated event to get ID
    void client?.getTransactionReceipt({ hash: createHash }).then(async receipt => {
      const { decodeEventLog } = await import('viem');
      for (const log of receipt.logs) {
        try {
          const result = decodeEventLog({ abi: SAVINGS_CIRCLES_ABI, ...log }) as {
            eventName: string; args: Record<string, unknown>;
          };
          if (result.eventName === 'CircleCreated') {
            setCreatedCircleId(result.args.id as bigint);
          }
        } catch { /* skip */ }
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contributionRaw || !depositAmount || !CONTRACT_ADDRESS) return;

    // Check if allowance is sufficient; if not, approve first
    const needsApprove = allowance === undefined || (allowance) < depositAmount;
    if (needsApprove) {
      setStep('approving');
      approve(
        {
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [CONTRACT_ADDRESS as `0x${string}`, parseUnits('1000000', USDC_DECIMALS)], // large approval
        },
        {
          onError(e) {
            toast.error(parseContractError(e));
            setStep('form');
          },
        }
      );
    } else {
      doCreate();
    }
  }

  function addInvite() {
    const addr = inviteInput.trim();
    if (!isAddress(addr)) { toast.error('Invalid address'); return; }
    if (inviteList.includes(addr)) { toast.error('Already in list'); return; }
    setInviteList(prev => [...prev, addr]);
    setInviteInput('');
  }

  if (step === 'done' && createdCircleId !== null) {
    const shareLink = `${window.location.origin}${window.location.pathname}#/circle/${createdCircleId}`;
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-12" style={{ background: 'var(--bg-gradient)' }}>
        <div className="max-w-md w-full rounded-3xl bg-[var(--surface-strong)] border border-[var(--border)] p-8 flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-[var(--success)] flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 className="display text-2xl font-bold text-[var(--ink)]">Circle created!</h2>
          <p className="text-[var(--muted)] text-sm text-center">Circle #{String(createdCircleId)} is live. Share the link below to invite members.</p>
          <div className="w-full rounded-xl bg-[var(--surface-muted)] border border-[var(--border)] px-3 py-2.5 text-xs text-[var(--ink-2)] font-mono break-all select-all">
            {shareLink}
          </div>
          <div className="flex gap-3 w-full">
            <button
              onClick={() => { void navigator.clipboard.writeText(shareLink).then(() => toast.success('Link copied!')).catch(() => {}); }}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface-muted)] transition"
            >
              Copy link
            </button>
            <button
              onClick={() => onNavigate(`/circle/${createdCircleId}`)}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition"
            >
              View circle
            </button>
          </div>
          {createHash && (
            <a href={buildExplorerTxUrl(createHash)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--muted)] flex items-center gap-1 hover:underline">
              View transaction <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
    );
  }

  const isBusy = step !== 'form' && step !== 'done';
  const busyLabel =
    isApprovePending ? 'Confirm approval in wallet…' :
    isApproveConfirming ? 'Approving USDC…' :
    isCreatePending ? 'Confirm in wallet…' :
    isCreateConfirming ? 'Creating circle…' : '';

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      <header className="border-b border-[var(--border)] bg-[var(--surface-strong)] backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => onNavigate('/')} className="p-1.5 rounded-lg hover:bg-[var(--surface-muted)] transition">
            <ArrowLeft size={18} className="text-[var(--ink)]" />
          </button>
          <h1 className="display text-lg font-bold text-[var(--ink)]">New Circle</h1>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 max-w-md mx-auto w-full px-4 py-6 flex flex-col gap-5">
        {/* Contribution */}
        <div>
          <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">
            Contribution per round
          </label>
          <div className="relative">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={contribution}
              onChange={e => setContribution(e.target.value)}
              placeholder="10.00"
              required
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 pr-20 text-[var(--ink)] tabular-nums placeholder:text-[var(--subtle)] focus:outline-none focus:border-[var(--focus)] text-lg font-semibold"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted)]">USDC</span>
          </div>
        </div>

        {/* Round length */}
        <div>
          <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">
            Round length
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min="1"
              value={roundLengthValue}
              onChange={e => setRoundLengthValue(e.target.value)}
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[var(--ink)] tabular-nums focus:outline-none focus:border-[var(--focus)]"
            />
            <select
              value={roundLengthUnit}
              onChange={e => setRoundLengthUnit(e.target.value as 'minutes' | 'days')}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-[var(--ink)] focus:outline-none focus:border-[var(--focus)]"
            >
              <option value="minutes">minutes</option>
              <option value="days">days</option>
            </select>
          </div>
        </div>

        {/* Number of members */}
        <div>
          <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">
            Number of members
          </label>
          <input
            type="number"
            min="2"
            max="20"
            value={size}
            onChange={e => setSize(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[var(--ink)] tabular-nums focus:outline-none focus:border-[var(--focus)]"
          />
        </div>

        {/* Deposit cover */}
        <div>
          <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">
            Deposit covers <span className="text-[var(--ink)] font-bold">{depositRoundsNum}</span> missed round{depositRoundsNum !== 1 ? 's' : ''}
          </label>
          <input
            type="range"
            min="1"
            max={Math.max(1, sizeNum - 1)}
            value={depositRounds}
            onChange={e => setDepositRounds(e.target.value)}
            className="w-full accent-[var(--accent)]"
          />
          <p className="text-xs text-[var(--muted)] mt-1.5">
            {depositRoundsNum === sizeNum - 1
              ? 'Every other member always gets a full pot — even if you stop paying after receiving.'
              : `Your deposit when joining: ${depositAmount !== undefined ? formatUsdc(depositAmount) : '—'}. Higher cover = stronger guarantees for the group.`}
          </p>
        </div>

        {/* Invite list */}
        <div>
          <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">
            Invite list <span className="font-normal text-[var(--subtle)]">(optional — leave empty for open circle)</span>
          </label>
          {inviteList.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {inviteList.map(addr => (
                <span key={addr} className="flex items-center gap-1.5 text-xs bg-[var(--surface-muted)] border border-[var(--border)] rounded-full px-3 py-1 text-[var(--ink-2)] font-mono">
                  {addr.slice(0, 8)}…{addr.slice(-4)}
                  <button type="button" onClick={() => setInviteList(prev => prev.filter(a => a !== addr))} className="text-[var(--muted)] hover:text-[var(--danger)]">
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={inviteInput}
              onChange={e => setInviteInput(e.target.value)}
              placeholder="0x…"
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--ink)] font-mono placeholder:text-[var(--subtle)] focus:outline-none focus:border-[var(--focus)]"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInvite(); } }}
            />
            <button type="button" onClick={addInvite} className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-muted)] transition">
              <Plus size={16} />
            </button>
          </div>
          {inviteList.length > 0 && inviteList.length < sizeNum && (
            <p className="text-xs text-[var(--danger)] mt-1">Need at least {sizeNum} addresses (circle size)</p>
          )}
        </div>

        {/* Summary */}
        {contributionRaw !== undefined && depositAmount !== undefined && contributionRaw > 0n && depositAmount > 0n && (
          <div className="rounded-xl bg-[var(--surface-muted)] border border-[var(--border)] px-4 py-3 flex flex-col gap-1 text-sm">
            <div className="flex justify-between"><span className="text-[var(--muted)]">Join deposit</span><span className="tabular-nums font-semibold text-[var(--ink)]">{formatUsdc(depositAmount)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--muted)]">Pot per round</span><span className="tabular-nums font-semibold text-[var(--ink)]">{formatUsdc(contributionRaw * BigInt(sizeNum))}</span></div>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isBusy || !contributionRaw || !address}
          className="w-full py-4 rounded-2xl bg-[var(--accent)] text-white font-bold text-base hover:bg-[var(--accent-hover)] disabled:opacity-50 transition mt-2"
        >
          {isBusy ? busyLabel : 'Create Circle'}
        </button>

        {!address && (
          <p className="text-center text-sm text-[var(--muted)]">Connect your wallet to create a circle.</p>
        )}
      </form>
    </div>
  );
}
