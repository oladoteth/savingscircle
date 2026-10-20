import { ExternalLink, CheckCircle } from "lucide-react";
import { buildExplorerTxUrl } from "@/utils/format";

interface ReceiptLinkProps {
  hash: `0x${string}` | undefined;
  isSuccess: boolean;
}

export function ReceiptLink({ hash, isSuccess }: ReceiptLinkProps) {
  if (!isSuccess || !hash) return null;
  return (
    <div className="rounded-2xl p-3 flex items-center gap-2" style={{ background: "rgba(26,128,71,0.08)" }}>
      <CheckCircle className="size-4 shrink-0" style={{ color: "var(--success)" }} />
      <span className="text-xs font-medium" style={{ color: "var(--success)" }}>Confirmed</span>
      <a
        href={buildExplorerTxUrl(hash)}
        target="_blank"
        rel="noreferrer"
        className="ml-auto inline-flex items-center gap-1 text-xs"
        style={{ color: "var(--accent-hover)" }}
      >
        View <ExternalLink className="size-3" />
      </a>
    </div>
  );
}
