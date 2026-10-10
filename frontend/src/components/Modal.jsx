import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../utils/cn";

export function Modal({ open, onClose, title, children, className = "" }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    // Move focus into the dialog (first field if there is one), restore it on close.
    const t = setTimeout(() => {
      // Prefer a form field; fall back to the first button (e.g. a confirm dialog).
      const target =
        panelRef.current?.querySelector("input, textarea, select") ||
        panelRef.current?.querySelector("button");
      target?.focus?.();
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full max-w-md rounded-2xl border border-white/10 bg-card p-6",
          "shadow-elevated animate-in fade-in zoom-in-95",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default Modal;
