import { USDC_DECIMALS } from '../appConfig';

/** Format raw 6-decimal USDC bigint as a human-readable string, e.g. "12.50 USDC" */
export function formatUsdc(raw: bigint | undefined, opts?: { symbol?: boolean }): string {
  if (raw === undefined) return '—';
  const num = Number(raw) / 10 ** USDC_DECIMALS;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return opts?.symbol === false ? formatted : `${formatted} USDC`;
}

/** Parse a user-typed USDC string (e.g. "5.00") into a raw bigint. Returns undefined on invalid. */
export function parseUsdc(value: string): bigint | undefined {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return undefined;
  return BigInt(Math.round(num * 10 ** USDC_DECIMALS));
}

/** Shorten an address: 0x1234...abcd */
export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Format a countdown from now to a unix timestamp (seconds) */
export function formatCountdown(deadlineSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadlineSec - now;
  if (diff <= 0) return 'Expired';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (diff < 86400) return `${h}h ${m}m`;
  const d = Math.floor(diff / 86400);
  return `${d}d ${h % 24}h`;
}

/** Format a round length in seconds to a readable label */
export function formatRoundLength(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

/** Parse error to a friendly message */
export function parseContractError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('user rejected') || lower.includes('user denied')) return 'Transaction cancelled.';
  if (lower.includes('alreadypaid') || lower.includes('already paid')) return 'You already paid this round.';
  if (lower.includes('alreadymember')) return 'You are already a member of this circle.';
  if (lower.includes('notmember')) return 'You are not a member of this circle.';
  if (lower.includes('notinvited')) return 'You are not on the invite list for this circle.';
  if (lower.includes('invalidstate')) return 'This action is not allowed in the current circle state.';
  if (lower.includes('roundclosedal')) return 'The round deadline has passed — close the round first.';
  if (lower.includes('roundstillopen')) return 'The round is still open. Wait for the deadline.';
  if (lower.includes('nothingtowithdraw')) return 'No funds available to withdraw.';
  if (lower.includes('invitelisttooshort')) return 'Invite list must have at least as many addresses as the circle size.';
  if (lower.includes('invalidcontribution')) return 'Contribution must be greater than zero.';
  if (lower.includes('invaliddepositrounds')) return 'Deposit cover must be between 1 and size − 1.';
  if (lower.includes('invalidsize')) return 'Circle size must be between 2 and 20.';
  if (lower.includes('circlenotfound')) return 'Circle not found.';
  if (lower.includes('insufficient')) return 'Insufficient USDC balance.';
  if (lower.includes('reverted')) {
    const m = msg.match(/reason="([^"]+)"/);
    if (m) return `Transaction failed: ${m[1]}`;
    return 'Transaction failed.';
  }
  return 'Something went wrong. Please try again.';
}

export { buildExplorerTxUrl, buildExplorerAddrUrl } from './contractHelpers';
