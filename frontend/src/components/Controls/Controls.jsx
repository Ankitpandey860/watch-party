import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { IconButton } from "../Buttons/IconButton";
import { formatTime } from "../../utils/youtube";
import { cn } from "../../utils/cn";

function Slider({ value, max, onChange, disabled, className = "" }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <input
      type="range"
      min={0}
      max={max}
      step={1}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(
        "h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5",
        "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
        "[&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-lg",
        "[&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110",
        className,
      )}
      style={{
        background: `linear-gradient(to right, oklch(0.65 0.22 15) 0%, oklch(0.62 0.2 280) ${pct}%, oklch(1 0 0 / 0.1) ${pct}%, oklch(1 0 0 / 0.1) 100%)`,
      }}
    />
  );
}

export function Controls({
  playing,
  currentTime,
  duration,
  volume,
  disabled = false,
  onPlay,
  onPause,
  onSeek,
  onVolume,
}) {
  const muted = volume === 0;
  return (
    <div className="rounded-2xl border border-white/10 bg-card p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="w-12 text-right font-mono text-xs text-muted-foreground">
          {formatTime(currentTime)}
        </span>
        <Slider
          value={currentTime}
          max={duration}
          onChange={onSeek}
          disabled={disabled}
        />
        <span className="w-12 font-mono text-xs text-muted-foreground">
          {formatTime(duration)}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <IconButton
            disabled={disabled}
            onClick={() => onSeek(Math.max(0, currentTime - 10))}
            aria-label="Back 10s"
          >
            <SkipBack className="h-4 w-4" />
          </IconButton>
          <button
            disabled={disabled}
            onClick={playing ? onPause : onPlay}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl gradient-hero text-white shadow-glow",
              "transition-all hover:brightness-110 active:scale-95",
              "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100",
            )}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause className="h-5 w-5 fill-white" />
            ) : (
              <Play className="h-5 w-5 fill-white ml-0.5" />
            )}
          </button>
          <IconButton
            disabled={disabled}
            onClick={() => onSeek(Math.min(duration, currentTime + 10))}
            aria-label="Forward 10s"
          >
            <SkipForward className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-xs">
          <IconButton
            onClick={() => onVolume(muted ? 60 : 0)}
            aria-label="Toggle mute"
            className="shrink-0"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </IconButton>
          <Slider value={volume} max={100} onChange={onVolume} />
          <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {volume}%
          </span>
        </div>
      </div>

      {disabled && (
        <p className="mt-3 text-center text-[11px] uppercase tracking-widest text-muted-foreground">
          Playback is controlled by the Host & Moderators
        </p>
      )}
    </div>
  );
}

export default Controls;