import { CHAIN_NAME, CHAIN_ID } from "@/appConfig";
import { useSwitchChain } from "wagmi";

export function WrongChainBanner({ chainId }: { chainId: number | undefined }) {
  const { switchChain } = useSwitchChain();
  if (!chainId || chainId === CHAIN_ID) return null;
  return (
    <div className="rounded-2xl p-3 flex items-center justify-between gap-3 mb-4"
      style={{ background: "rgba(186,43,76,0.08)", border: "1px solid rgba(186,43,76,0.2)" }}>
      <p className="text-xs" style={{ color: "var(--danger)" }}>
        Switch to {CHAIN_NAME} to use this app.
      </p>
      <button
        onClick={() => switchChain({ chainId: CHAIN_ID })}
        className="text-xs font-semibold px-3 py-1 rounded-xl"
        style={{ background: "var(--danger)", color: "#fff" }}
      >
        Switch
      </button>
    </div>
  );
}
