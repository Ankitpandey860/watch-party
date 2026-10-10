import { cn } from "../utils/cn";

const palette = [
  "from-rose-500 to-orange-500",
  "from-indigo-500 to-purple-500",
  "from-emerald-500 to-teal-500",
  "from-sky-500 to-blue-500",
  "from-fuchsia-500 to-pink-500",
  "from-amber-500 to-yellow-500",
];

function hash(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name = "?", size = 40, online, className = "" }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const gradient = palette[hash(name) % palette.length];
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <div
        className={cn(
          "flex items-center justify-center rounded-full text-white font-semibold",
          "bg-gradient-to-br shadow-elevated",
          gradient,
        )}
        style={{ width: size, height: size, fontSize: size * 0.38 }}
      >
        {initials || "?"}
      </div>
      {typeof online === "boolean" && (
        <span
          className={cn(
            "absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-background",
            online ? "bg-[oklch(0.7_0.17_155)]" : "bg-muted-foreground/60",
          )}
        />
      )}
    </div>
  );
}

export default Avatar;
