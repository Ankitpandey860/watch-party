import { cn } from "../../utils/cn";

const variants = {
  primary: "gradient-hero text-white shadow-glow hover:brightness-110 focus:ring-primary",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 focus:ring-secondary",
  ghost: "bg-transparent text-foreground hover:bg-white/5 focus:ring-white/20",
  outline:
    "border border-white/15 bg-white/[0.02] text-foreground hover:bg-white/[0.06] focus:ring-white/20",
  danger: "bg-destructive text-destructive-foreground hover:brightness-110 focus:ring-destructive",
  glass: "glass text-foreground hover:bg-white/[0.08] focus:ring-white/20",
};

const sizes = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "h-10 w-10",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  loading = false,
  disabled,
  ...rest
}) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium",
        "transition-all duration-200 ease-out",
        "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100",
        "active:scale-[0.98]",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && (
        <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
      )}
      {children}
    </button>
  );
}

export default Button;
