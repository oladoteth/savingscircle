import { Loader2 } from "lucide-react";

interface TxButtonProps {
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  isPending?: boolean;
  isConfirming?: boolean;
  /** Show "Updating…" while a refetch is in-flight after confirmation. */
  isUpdating?: boolean;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  fullWidth?: boolean;
  size?: "sm" | "md";
}

export function TxButton({
  onClick, disabled, disabledReason, isPending, isConfirming, isUpdating, label,
  variant = "primary", fullWidth = false, size = "md",
}: TxButtonProps) {
  const busy = isPending || isConfirming || isUpdating;
  const isDisabled = disabled || busy;

  const base = `inline-flex items-center justify-center gap-2 font-semibold rounded-2xl transition-all
    active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40
    ${fullWidth ? "w-full" : ""}
    ${size === "sm" ? "px-4 py-2 text-xs" : "px-5 py-3.5 text-sm"}`;

  const variants: Record<string, string> = {
    primary:   "text-white hover:scale-[1.01]",
    secondary: "border text-sm",
    danger:    "text-white",
    ghost:     "text-sm",
  };

  const inlineStyles: Record<string, React.CSSProperties> = {
    primary:   { background: "var(--accent)" },
    secondary: { background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink)" },
    danger:    { background: "var(--danger)" },
    ghost:     { background: "transparent", color: "var(--accent)" },
  };

  function statusLabel() {
    if (isPending)    return "Confirm in wallet…";
    if (isConfirming) return "Confirming…";
    if (isUpdating)   return "Updating…";
    return label;
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        className={`${base} ${variants[variant]}`}
        style={inlineStyles[variant]}
        disabled={isDisabled}
        onClick={onClick}
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {statusLabel()}
          </>
        ) : label}
      </button>
      {isDisabled && disabledReason && !busy && (
        <p className="text-xs text-center" style={{ color: "var(--muted)" }}>{disabledReason}</p>
      )}
    </div>
  );
}
