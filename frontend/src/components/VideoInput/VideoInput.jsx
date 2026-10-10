import { useState } from "react";
import { Link as LinkIcon, RefreshCw } from "lucide-react";
import { Card } from "../Card";
import { Input } from "../Input";
import { Button } from "../Buttons/Button";
import providerRegistry from "../../providers";

export function VideoInput({ disabled, onChangeVideo }) {
  const [url, setUrl] = useState("");
  const resolved = providerRegistry.resolve(url);
  const valid = Boolean(resolved);
  const label = providerRegistry
    .list()
    .map((p) => p.label)
    .join(" / ");

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06]">
          <LinkIcon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">Load a video ({label})</p>
          <p className="text-xs text-muted-foreground">
            Everyone in the room will watch what you set.
          </p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onChangeVideo?.(url);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <Input
          aria-label="Video link"
          placeholder={providerRegistry.list()[0].placeholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={disabled}
          error={url && !valid ? `Enter a valid ${label} link or video ID` : ""}
        />
        <Button type="submit" disabled={disabled || !valid} className="sm:w-auto">
          <RefreshCw className="h-4 w-4" />
          Change Video
        </Button>
      </form>
      {disabled && (
        <p className="mt-3 text-[11px] uppercase tracking-widest text-muted-foreground">
          Only Host & Moderators can change the video
        </p>
      )}
    </Card>
  );
}

export default VideoInput;
