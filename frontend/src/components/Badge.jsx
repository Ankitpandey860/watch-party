import { cn } from "../utils/cn";

const tones = {
  neutral: "bg-white/8 text-foreground border-white/10",
  host: "bg-[oklch(0.65_0.22_15/0.15)] text-[oklch(0.78_0.18_15)] border-[oklch(0.65_0.22_15/0.35)]",
  moderator:
    "bg-[oklch(0.62_0.2_280/0.15)] text-[oklch(0.78_0.16_280)] border-[oklch(0.62_0.2_280/0.35)]",
  participant:
    "bg-[oklch(0.6_0.16_235/0.12)] text-[oklch(0.78_0.14_235)] border-[oklch(0.6_0.16_235/0.3)]",
  playing:
    "bg-[oklch(0.7_0.17_155/0.15)] text-[oklch(0.82_0.15_155)] border-[oklch(0.7_0.17_155/0.35)]",
  paused: "bg-white/8 text-muted-foreground border-white/10",
  online:
    "bg-[oklch(0.7_0.17_155/0.15)] text-[oklch(0.82_0.15_155)] border-[oklch(0.7_0.17_155/0.35)]",
  offline: "bg-white/5 text-muted-foreground border-white/10",
  warning:
    "bg-[oklch(0.78_0.16_75/0.15)] text-[oklch(0.85_0.14_75)] border-[oklch(0.78_0.16_75/0.35)]",
};

export function Badge({ tone = "neutral", className = "", children, dot = false }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-[11px] font-medium uppercase tracking-wider",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export default Badge;