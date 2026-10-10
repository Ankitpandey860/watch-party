import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { detectCapabilities, EFFECTS_EVENT, setEffectsPreference } from "../../three/capabilities";
import { cn } from "../../utils/cn";

/** Real control: turns the 3D effects on/off (saved as a UI preference). Hidden when WebGL is unavailable. */
export function EffectsToggle({ className }) {
  const [caps, setCaps] = useState(null);

  useEffect(() => {
    const read = () => setCaps(detectCapabilities());
    read();
    window.addEventListener(EFFECTS_EVENT, read);
    return () => window.removeEventListener(EFFECTS_EVENT, read);
  }, []);

  if (!caps || !caps.webgl) return null;
  const on = caps.mode !== "off";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setEffectsPreference(on ? "off" : "on")}
      title={on ? "Turn 3D effects off" : "Turn 3D effects on"}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        on
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      3D {on ? "on" : "off"}
    </button>
  );
}

export default EffectsToggle;
