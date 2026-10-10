import { forwardRef } from "react";
import { cn } from "../utils/cn";

export const Input = forwardRef(function Input(
  { className = "", label, hint, error, id, ...rest },
  ref,
) {
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={cn(
          "w-full h-11 rounded-xl px-4 text-sm",
          "bg-white/[0.04] border border-white/10 text-foreground placeholder:text-muted-foreground/70",
          "transition-all focus:outline-none focus:border-primary/60 focus:bg-white/[0.06]",
          "focus:ring-2 focus:ring-primary/20",
          error && "border-destructive/60 focus:border-destructive focus:ring-destructive/20",
          className,
        )}
        {...rest}
      />
      {hint && !error && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
});

export default Input;
