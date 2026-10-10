import { cn } from "../utils/cn";

/** A full-width message screen for terminal/empty states (not found, full, banned, signed out...). */
export function StatusScreen({
  icon: Icon,
  tone = "neutral",
  title,
  children,
  actions,
  className,
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center px-4 py-16 text-center",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {Icon && (
        <div
          className={cn(
            "mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border",
            tone === "danger"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-white/10 bg-white/[0.04] text-muted-foreground",
          )}
        >
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      )}
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
export default StatusScreen;
