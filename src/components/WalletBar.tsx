import { ConnectKitButton } from 'connectkit';
import { useAccount, useReadContract } from 'wagmi';
import { erc20Abi } from 'viem';
import { USDC_ADDRESS, CHAIN_ID, CONTRACT_ADDRESS } from '../appConfig';
import { formatUsdc, parseContractError } from '../utils/format';
import { SAVINGS_CIRCLES_ABI } from '../abi';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import { buildExplorerTxUrl } from '../utils/contractHelpers';

export default function WalletBar() {
  const { address, isConnected } = useAccount();

  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });

  const { data: claimableBal, refetch: refetchClaimable } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SAVINGS_CIRCLES_ABI,
    functionName: 'claimable',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!CONTRACT_ADDRESS },
  });

  const { writeContract, data: withdrawHash, isPending: isWithdrawPending } = useWriteContract();
  const { isLoading: isWithdrawConfirming, isSuccess: isWithdrawSuccess } = useWaitForTransactionReceipt({ hash: withdrawHash });

  const handleWithdraw = () => {
    if (!CONTRACT_ADDRESS) return;
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: SAVINGS_CIRCLES_ABI,
        functionName: 'withdraw',
        args: [],
      },
      {
        onError(e) { toast.error(parseContractError(e)); },
      }
    );
  };

  if (isWithdrawSuccess && withdrawHash) {
    toast.success(
      <span className="flex items-center gap-2">
        Withdrawn!{' '}
        <a href={buildExplorerTxUrl(withdrawHash)} target="_blank" rel="noopener noreferrer" className="underline flex items-center gap-1">
          View <ExternalLink size={12} />
        </a>
      </span>
    );
    void refetchUsdc();
    void refetchClaimable();
  }

  if (!isConnected) {
    return (
      <div className="flex justify-end px-4 py-3">
        <ConnectKitButton label="Connect wallet" />
      </div>
    );
  }

  const hasClaimable = claimableBal !== undefined && claimableBal > 0n;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3">
      <div className="flex gap-6">
        <div>
          <p className="text-xs text-[var(--muted)] uppercase tracking-widest">Balance</p>
          <p className="font-semibold text-[var(--ink)] tabular-nums">{formatUsdc(usdcBalance)}</p>
        </div>
        {hasClaimable && (
          <div>
            <p className="text-xs text-[var(--muted)] uppercase tracking-widest">Claimable</p>
            <p className="font-semibold text-[var(--success)] tabular-nums">{formatUsdc(claimableBal)}</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {hasClaimable && (
          <button
            onClick={handleWithdraw}
            disabled={isWithdrawPending || isWithdrawConfirming}
            className="px-4 py-1.5 text-sm font-semibold rounded-full bg-[var(--success)] text-white disabled:opacity-50 transition"
          >
            {isWithdrawPending ? 'Confirm…' : isWithdrawConfirming ? 'Withdrawing…' : 'Withdraw'}
          </button>
        )}
        <ConnectKitButton />
      </div>
    </div>
  );
}
