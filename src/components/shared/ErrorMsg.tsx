import { AlertCircle } from "lucide-react";
import { parseContractError } from "@/utils/format";

export function ErrorMsg({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-2xl p-3 flex items-center gap-2" style={{ background: "rgba(186,43,76,0.08)" }}>
      <AlertCircle className="size-4 shrink-0" style={{ color: "var(--danger)" }} />
      <p className="text-xs" style={{ color: "var(--danger)" }}>{parseContractError(error)}</p>
    </div>
  );
}
