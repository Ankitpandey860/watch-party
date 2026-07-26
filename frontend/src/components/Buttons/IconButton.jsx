import { cn } from "../../utils/cn";

export function IconButton({ className = "", children, ...rest }) {
  return (
    <button
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-xl",
        "bg-white/[0.04] border border-white/10 text-foreground",
        "transition-all hover:bg-white/[0.08] hover:border-white/20",
        "active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export default IconButton;