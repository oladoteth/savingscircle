import { useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { useAccount } from "wagmi";
import { CHAIN_ID } from "@/appConfig";

/** Thin wrapper around wagmi write + wait, with chain-switch guard */
export function useContractAction() {
  const { chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const wrongChain = !!chainId && chainId !== CHAIN_ID;

  return { writeContract, hash, isPending, isConfirming, isSuccess, error, reset, wrongChain, switchChain };
}
