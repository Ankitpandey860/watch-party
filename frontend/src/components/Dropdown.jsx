import { useEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";

export function Dropdown({ trigger, items = [], align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute z-40 mt-2 min-w-[190px] rounded-xl border border-white/10 bg-popover p-1.5 shadow-elevated",
            "animate-in fade-in zoom-in-95",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} className="my-1 h-px bg-white/10" />
            ) : (
              <button
                key={i}
                onClick={() => {
                  it.onClick?.();
                  setOpen(false);
                }}
                disabled={it.disabled}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm",
                  "text-foreground hover:bg-white/5 transition-colors",
                  it.danger && "text-destructive hover:bg-destructive/10",
                  it.disabled && "opacity-40 cursor-not-allowed hover:bg-transparent",
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