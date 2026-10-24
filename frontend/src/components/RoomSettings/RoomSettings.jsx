import { useId } from "react";
import { SlidersHorizontal } from "lucide-react";

export const MAX_MODERATOR_LIMIT = 10; // server clamps to the same range

/**
 * Room settings. The HOST can change them (the server enforces that independently); everyone else
 * sees the current values read-only. Changes are only sent on user action and only take effect
 * when the server confirms them via `room_settings` (no optimistic local state).
 */
export function RoomSettings({ settings, isHost, moderatorCount = 0, onChange }) {
  const switchId = useId();
  const capId = useId();
  const { moderatorsCanControl, maxModerators } = settings;

  if (!isHost) {
    return (
      <p className="mb-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-muted-foreground">
        Moderators {moderatorsCanControl ? "can" : "can't"} control playback · up to {maxModerators}{" "}
        {maxModerators === 1 ? "moderator" : "moderators"}
      </p>
    );
  }

  return (
    <section
      aria-label="Room settings"
      className="mb-3 space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3"
    >
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Room settings
      </h3>

      <div className="flex items-start justify-between gap-3">
        <label htmlFor={switchId} className="text-sm">
          Moderators can control playback
          <span className="block text-xs text-muted-foreground">
            Off: only you can play, pause, seek or change the video.
          </span>
        </label>
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          checked={moderatorsCanControl}
          onChange={(e) => onChange?.({ moderatorsCanControl: e.target.checked })}
          className="mt-1 h-5 w-9 shrink-0 cursor-pointer accent-primary"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <label htmlFor={capId} className="text-sm">
          Max moderators
          <span className="block text-xs text-muted-foreground">
            {moderatorCount} now · 0–{MAX_MODERATOR_LIMIT}, host not counted
          </span>
        </label>
        <input
          id={capId}
          type="number"
          min={moderatorCount}
          max={MAX_MODERATOR_LIMIT}
          step={1}
          value={maxModerators}
          onChange={(e) => {
            const n = Number(e.target.value);
            // Can't go below the people already promoted (the server refuses that too).
            if (Number.isInteger(n) && n >= moderatorCount && n <= MAX_MODERATOR_LIMIT) {
              onChange?.({ maxModerators: n });
            }
          }}
          className="h-9 w-16 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-center text-sm"
        />
      </div>
    </section>
  );
}

export default RoomSettings;
