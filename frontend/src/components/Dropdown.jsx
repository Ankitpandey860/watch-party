import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { cn } from "../utils/cn";

/**
 * Menu button. Keyboard: Enter/Space/ArrowDown opens, Arrow keys move, Escape closes (focus returns
 * to the trigger). The `trigger` should be a single <button>; it receives the ARIA wiring.
 */
export function Dropdown({ trigger, items = [], align = "right", label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector("[role=menuitem]:not([disabled])")?.focus();
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus?.();
  };

  const onMenuKey = (e) => {
    const enabled = [...menuRef.current.querySelectorAll("[role=menuitem]:not([disabled])")];
    const i = enabled.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      enabled[(i + 1) % enabled.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      enabled[(i - 1 + enabled.length) % enabled.length]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  const wiredTrigger = isValidElement(trigger)
    ? cloneElement(trigger, {
        ref: triggerRef,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        "aria-label": trigger.props["aria-label"] || label,
        onClick: (e) => {
          trigger.props.onClick?.(e);
          setOpen((o) => !o);
        },
        onKeyDown: (e) => {
          trigger.props.onKeyDown?.(e);
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        },
      })
    : trigger;

  return (
    <div ref={ref} className="relative inline-block">
      {wiredTrigger}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={cn(
            "absolute z-40 mt-2 min-w-[190px] rounded-xl border border-white/10 bg-popover p-1.5 shadow-elevated",
            "animate-in fade-in zoom-in-95",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} role="separator" className="my-1 h-px bg-white/10" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={() => {
                  it.onClick?.();
                  close(false);
                }}
                disabled={it.disabled}
                title={it.hint}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                  "text-foreground transition-colors hover:bg-white/5 focus:bg-white/10 focus:outline-none",
                  it.danger && "text-destructive hover:bg-destructive/10",
                  it.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
                )}
              >
                {it.icon}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
export default Dropdown;
