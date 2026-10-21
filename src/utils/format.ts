import { USDC_DECIMALS, EXPLORER_BASE } from "@/appConfig";

/** Format a raw bigint USDC amount to a human-readable string, e.g. "12.50" */
export function formatUsdc(raw: bigint | undefined | null, decimals = 2): string {
  if (raw === undefined || raw === null) return "—";
  const n = Number(raw) / 10 ** USDC_DECIMALS;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Parse a user-entered USDC string to raw bigint */
export function parseUsdc(s: string): bigint {
  const trimmed = s.trim();
  if (!trimmed || isNaN(Number(trimmed))) return 0n;
  const [intPart = "0", fracPart = ""] = trimmed.split(".");
  const frac = fracPart.slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, "0");
  return BigInt(intPart) * BigInt(10 ** USDC_DECIMALS) + BigInt(frac);
}

/** Shorten an address: 0x1234…5678 */
export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Format seconds remaining into human-readable countdown */
export function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "now";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Format a period length in seconds to a readable string */
export function formatPeriodLength(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/** Map contract custom errors to user-friendly messages */
export function parseContractError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("user denied")) return "Transaction cancelled.";
  if (lower.includes("pottoosmall"))    return "Pot doesn't have enough yet. Wait for more contributions.";
  if (lower.includes("hasarrears"))     return "You have unpaid contributions. Pay your share first.";
  if (lower.includes("alreadytaken"))   return "You already took the payout this cycle.";
  if (lower.includes("circlefull"))     return "This circle is already full.";
  if (lower.includes("notinvited"))     return "You're not on the invite list for this circle.";
  if (lower.includes("depositnotfull"))  return "Deposit isn't full. Top up before starting.";
  if (lower.includes("notenoughmembers")) return "Not enough members to start the cycle.";
  if (lower.includes("tooearlytosettl")) return "The cycle isn't over yet.";
  if (lower.includes("tooearlytostart")) return "The cooldown window hasn't passed yet. Members need time to leave.";
  if (lower.includes("graceperiodnotelapsed")) return "Grace period hasn't passed yet.";
  if (lower.includes("nothingtowithdr")) return "Nothing to withdraw right now.";
  if (lower.includes("invalidstate"))   return "This action isn't available in the current state.";
  if (lower.includes("alreadymember"))  return "You're already in this circle.";
  if (lower.includes("notmember"))      return "You're not a member of this circle.";
  if (lower.includes("depositalreadyfull")) return "Your deposit is already at the full amount.";
  if (lower.includes("insufficient funds") || lower.includes("exceeds balance")) return "Not enough USDC in your wallet.";
  if (lower.includes("network") || lower.includes("timeout")) return "Network error. Please try again.";
  if (lower.includes("reverted")) {
    const match = msg.match(/reason="([^"]+)"/);
    if (match) return `Transaction failed: ${match[1]}`;
    return "Transaction failed. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

export function buildExplorerTxUrl(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

export function buildExplorerAddrUrl(addr: string): string {
  return `${EXPLORER_BASE}/address/${addr}`;
}
