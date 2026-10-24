import { useId, useState } from "react";
import { Link as LinkIcon, RefreshCw } from "lucide-react";
import { Card } from "../Card";
import { Input } from "../Input";
import { Button } from "../Buttons/Button";
import { Badge } from "../Badge";
import providerRegistry from "../../providers";

const AUTO = "auto";

/** "Play/pause · Seek · Speed" or an explicit "Not synchronised" for media that can't be controlled. */
export function capabilitySummary(caps) {
  if (!caps || !caps.sync) return ["Shown only, not synchronised"];
  return [
    caps.play && caps.pause ? "Play/pause" : null,
    caps.seek ? "Seek" : null,
    caps.rate ? "Speed" : "No speed control",
  ].filter(Boolean);
}

export function VideoInput({ disabled, disabledMessage, onChangeVideo }) {
  const selectId = useId();
  const [url, setUrl] = useState("");
  const [choice, setChoice] = useState(AUTO);
  const hint = choice === AUTO ? undefined : choice;
  const resolved = providerRegistry.resolve(url, hint);
  const valid = Boolean(resolved);
  const providers = providerRegistry.list();
  // The provider whose capabilities/limits we show: the chosen one, or the one the input resolved to.
  const shown = providerRegistry.get(hint || resolved?.provider);
  const caps = resolved
    ? providerRegistry.capabilitiesFor(resolved.provider, resolved.params)
    : shown?.capabilities;
  const names = providers.map((p) => p.label).join(" / ");
  const error =
    url.trim() && !valid
      ? hint || /twitch\.tv/i.test(url)
        ? providerRegistry.explain(url, hint)
        : `Enter a valid link or video ID (${providers.map((p) => p.label).join(", ")})`
      : "";

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06]">
          <LinkIcon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">Load a video ({names})</p>
          <p className="text-xs text-muted-foreground">
            Everyone in the room will watch what you set.
          </p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          // Auto-detect keeps the original one-argument call; an explicit provider travels with it.
          if (hint) onChangeVideo?.(url, hint);
          else onChangeVideo?.(url);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <div className="sm:w-40">
          <label htmlFor={selectId} className="sr-only">
            Provider
          </label>
          <select
            id={selectId}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            disabled={disabled}
            className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm"
          >
            <option value={AUTO}>Auto-detect</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <Input
          aria-label="Video link"
          placeholder={shown?.placeholder || "Paste a YouTube, Vimeo, Twitch or Netflix link…"}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={disabled}
          error={error}
        />
        <Button type="submit" disabled={disabled || !valid} className="sm:w-auto">
          <RefreshCw className="h-4 w-4" />
          Change Video
        </Button>
      </form>

      {(resolved || shown) && (
        <div className="mt-3 space-y-2 text-xs text-muted-foreground" data-testid="provider-info">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{providerRegistry.labelFor(resolved?.provider || shown.id)}</Badge>
            {shown?.mode === "companion" && <Badge tone="neutral">Needs browser extension</Badge>}
            {capabilitySummary(caps).map((c) => (
              <Badge key={c} tone={caps?.sync ? "playing" : "paused"}>
                {c}
              </Badge>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer select-none">Limitations</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {(providerRegistry.get(resolved?.provider || shown.id)?.limitations || []).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {disabled && (
        <p className="mt-3 text-[11px] uppercase tracking-widest text-muted-foreground">
          {disabledMessage || "Only Host & Moderators can change the video"}
        </p>
      )}
    </Card>
  );
}

export default VideoInput;
