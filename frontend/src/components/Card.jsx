import { cn } from "../utils/cn";

export function Card({ className = "", glass = false, children, ...rest }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-card p-6",
        glass && "glass",
        !glass && "shadow-elevated",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Card;
