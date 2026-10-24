import { ExternalLink, PlugZap, ShieldCheck, Unplug } from "lucide-react";
import { Badge } from "../Badge";
import { Button } from "../Buttons/Button";
import { useRoom } from "../../context/RoomContext";
import providerRegistry from "../../providers";
import { useExtensionPairing } from "../../hooks/useExtensionPairing";

const STATUS_COPY = {
  ready: { tone: "playing", text: "In sync" },
  wrong_title: { tone: "paused", text: "Wrong title open" },
  blocked: { tone: "paused", text: "Click play in Netflix" },
  no_player: { tone: "paused", text: "No Netflix player yet" },
  unsupported: { tone: "paused", text: "Unsupported page" },
};

/**
 * Netflix cannot be embedded, so this room view is the control centre for the viewer's OWN Netflix tab:
 * pairing the extension, seeing whether it is connected, and who has the right title open. The video
 * itself plays on netflix.com in the viewer's account; nothing from Netflix passes through this app.
 */
export function NetflixCompanion({ videoUrl }) {
  const { roomId, userId, participants, role, settings } = useRoom();
  const media = providerRegistry.resolve(videoUrl, "netflix");
  const pairing = useExtensionPairing(roomId, { enabled: Boolean(roomId) });
  const me = participants.find((p) => p.id === userId);
  const mine = me?.playerStatus ? STATUS_COPY[me.playerStatus] : null;
  const online = participants.filter((p) => p.online);
  const ready = online.filter((p) => p.playerStatus === "ready").length;
  const wrong = online.filter((p) => p.playerStatus === "wrong_title");
  const canControl =
    role === "host" || (role === "moderator" && settings?.moderatorsCanControl !== false);

  const connection = pairing.status.connected
    ? { tone: "playing", text: "Extension connected" }
    : pairing.status.paired
      ? { tone: "paused", text: "Paired, extension offline" }
      : { tone: "neutral", text: "Extension not paired" };

  return (
    <div
      className="rounded-2xl border border-white/10 bg-black/60 p-5 shadow-elevated sm:p-6"
      data-testid="netflix-companion"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">Netflix</Badge>
        <Badge tone={connection.tone} dot>
          {connection.text}
        </Badge>
        {pairing.status.connected && mine && (
          <Badge tone={mine.tone} dot>
            {mine.text}
          </Badge>
        )}
      </div>

      {!media ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No Netflix title is loaded yet.{" "}
          {canControl ? "Paste a netflix.com/watch link below." : "The host will load one."}
        </p>
      ) : (
        <div className="mt-4 space-y-4 text-sm">
          <p>
            Everyone watches in <b>their own Netflix tab</b> with their own account. Open the room's
            title, and the extension keeps your playback in sync with{" "}
            {canControl ? "the room (your controls drive it)" : "the host"}.
          </p>
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open title {media.mediaId} on
            Netflix
          </a>

          <section
            aria-label="Extension pairing"
            className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
          >
            <div className="flex items-center gap-2 font-medium">
              <PlugZap className="h-4 w-4" aria-hidden="true" /> Browser extension
            </div>
            {pairing.status.paired ? (
              <div className="mt-3 space-y-3">
                <p className="text-muted-foreground">
                  Paired{pairing.status.label ? ` (${pairing.status.label})` : ""}.{" "}
                  {pairing.status.connected
                    ? "It's connected to this room."
                    : "It isn't connected right now; open the extension popup and press Reconnect."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={pairing.revoke}
                  disabled={pairing.busy}
                >
                  <Unplug className="h-4 w-4" aria-hidden="true" /> Revoke pairing
                </Button>
              </div>
            ) : pairing.code ? (
              <div className="mt-3 space-y-2">
                <p className="text-muted-foreground">
                  In the extension popup enter this code and this site's address:
                </p>
                <p
                  className="select-all font-mono text-2xl tracking-widest"
                  aria-label="Pairing code"
                  data-testid="pairing-code"
                >
                  {pairing.code}
                </p>
                <p className="text-xs text-muted-foreground">
                  Single use, expires in {pairing.expiresIn}s. Site address:{" "}
                  <span className="select-all font-mono">
                    {typeof window !== "undefined" ? window.location.origin : ""}
                  </span>
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-muted-foreground">
                  Install the Watch Party extension (see <i>docs/EXTENSION.md</i>), then pair it
                  with your seat in this room.
                </p>
                <Button type="button" onClick={pairing.pair} disabled={pairing.busy}>
                  Pair extension
                </Button>
              </div>
            )}
            {pairing.error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {pairing.error}
              </p>
            )}
          </section>

          <section aria-label="Who is in sync" className="text-muted-foreground">
            <p>
              {ready} of {online.length} online {online.length === 1 ? "person has" : "people have"}{" "}
              the right title open and in sync.
            </p>
            {wrong.length > 0 && (
              <p className="mt-1 text-warning">
                Wrong title open: {wrong.map((p) => p.username).join(", ")}. They need to open the
                title above.
              </p>
            )}
          </section>
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Only the title id, play/pause state and position are shared. Your Netflix login, cookies and
        video never reach Watch Party.
      </p>
    </div>
  );
}

export default NetflixCompanion;
