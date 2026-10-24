// Frontend provider registry (data only: no React, no network).
//
// Each descriptor says how to recognise and rebuild media references AND what the integration can
// honestly do (`capabilities`) and cannot (`limitations`). The room, context and UI only consult
// this, so they never special-case a provider. A provider is listed here ONLY when its integration
// is real: an official embeddable player SDK (mode "embedded") or our browser extension controlling
// the viewer's own session (mode "companion"). Nothing is listed because its name is popular.
//
//   mode "embedded"  – the provider's own player runs inside our page (components/Player/PlayerHost.jsx)
//   mode "companion" – plays in the viewer's own tab, controlled by the browser extension (Netflix)
//
// capabilities.sync   true  => play/pause/seek are synchronised across the room
//                     false => the media is shown but cannot be remote-controlled (e.g. Twitch clips)
import { parseYouTube, parseVimeo, parseTwitch, parseNetflix, explainTwitch } from "./parsers";

const youtube = Object.freeze({
  id: "youtube",
  label: "YouTube",
  mode: "embedded",
  placeholder: "Paste a YouTube link or video ID…",
  example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  capabilities: Object.freeze({ sync: true, play: true, pause: true, seek: true, rate: true }),
  limitations: Object.freeze(["Videos whose owner disabled embedding can't be played."]),
  parse: parseYouTube,
  urlFor: (mediaId) => `https://www.youtube.com/watch?v=${mediaId}`,
  explain: () => "Enter a YouTube link or an 11-character video ID.",
});

const vimeo = Object.freeze({
  id: "vimeo",
  label: "Vimeo",
  mode: "embedded",
  placeholder: "Paste a Vimeo link (unlisted links keep their …/<id>/<hash>)…",
  example: "https://vimeo.com/76979871",
  capabilities: Object.freeze({ sync: true, play: true, pause: true, seek: true, rate: true }),
  limitations: Object.freeze([
    "Private videos need the owner's embed permission for this site (domain-level privacy).",
    "Unlisted videos only work with their full link (it carries the privacy hash).",
    "Playback speed can be disabled by the video owner.",
  ]),
  parse: parseVimeo,
  urlFor: (mediaId, params) =>
    `https://vimeo.com/${mediaId}${params?.hash ? `/${params.hash}` : ""}`,
  explain: () => "That doesn't look like a Vimeo link (e.g. https://vimeo.com/123456789).",
});

const twitch = Object.freeze({
  id: "twitch",
  label: "Twitch",
  mode: "embedded",
  placeholder: "Paste a Twitch past broadcast (/videos/…) or clip link…",
  example: "https://www.twitch.tv/videos/123456789",
  // VODs are fully synchronised; clips are shown but cannot be remote-controlled (see paramsCaps).
  capabilities: Object.freeze({ sync: true, play: true, pause: true, seek: true, rate: false }),
  paramsCaps: (params) =>
    params?.kind === "clip"
      ? Object.freeze({ sync: false, play: false, pause: false, seek: false, rate: false })
      : null,
  limitations: Object.freeze([
    "Live streams can't be synchronised and are refused.",
    "Clips play in Twitch's own embed: everyone presses play themselves (no remote control).",
    "Playback speed isn't available on Twitch's embed.",
    "Subscriber-only and mature VODs need the viewer to be signed in to Twitch.",
  ]),
  parse: parseTwitch,
  urlFor: (mediaId, params) =>
    params?.kind === "clip"
      ? `https://clips.twitch.tv/${mediaId}`
      : `https://www.twitch.tv/videos/${mediaId}`,
  explain: explainTwitch,
});

const netflix = Object.freeze({
  id: "netflix",
  label: "Netflix",
  mode: "companion",
  placeholder: "Paste the address of the playing title: netflix.com/watch/…",
  example: "https://www.netflix.com/watch/80100172",
  capabilities: Object.freeze({ sync: true, play: true, pause: true, seek: true, rate: false }),
  limitations: Object.freeze([
    "Every viewer needs their own Netflix account and the Watch Party browser extension (desktop Chrome/Chromium).",
    "Netflix can't be embedded: it plays in the viewer's own Netflix tab.",
    "Uses Netflix's undocumented player interface; a Netflix update can reduce sync to play/pause only (the extension tells you).",
    "Ads (ad-supported plans) pause synchronisation until the ad ends.",
  ]),
  parse: parseNetflix,
  urlFor: (mediaId) => `https://www.netflix.com/watch/${mediaId}`,
  explain: () =>
    "Paste the address of the playing title: https://www.netflix.com/watch/<number>. (Title pages like /title/… aren't playback pages.)",
});

const providers = Object.freeze([youtube, vimeo, twitch, netflix]);

export const providerRegistry = {
  get: (id) => providers.find((p) => p.id === id) || null,
  list: () => providers,
  /**
   * Resolves input -> { provider, mediaId, params } | null. With `hint` (a provider id) only that
   * provider is tried and bare IDs are accepted; without it the first provider that recognises the
   * input wins (bare 11-char IDs are YouTube).
   */
  resolve(input, hint) {
    if (hint !== undefined && hint !== null) {
      const p = this.get(hint);
      const parsed = p ? p.parse(input, { explicit: true }) : null;
      return parsed
        ? { provider: p.id, mediaId: parsed.mediaId, params: parsed.params || {} }
        : null;
    }
    for (const p of providers) {
      const parsed = p.parse(input, { explicit: false });
      if (parsed) return { provider: p.id, mediaId: parsed.mediaId, params: parsed.params || {} };
    }
    return null;
  },
  /** Why an input was refused (provider-specific when a provider is chosen). */
  explain(input, hint) {
    const p = hint ? this.get(hint) : null;
    if (p) return p.explain(input);
    const live = explainTwitch(input);
    if (/Live Twitch/.test(live)) return live; // recognised-but-unsupported beats a generic message
    return "That doesn't look like a supported video link or ID.";
  },
  /** Display URL for a media reference ("" when there is none). Defaults to YouTube for old callers. */
  urlFor(providerId, mediaId, params) {
    const p = providerId ? this.get(providerId) : providers[0];
    return p && mediaId ? p.urlFor(mediaId, params || {}) : "";
  },
  labelFor: (providerId) => providerRegistry.get(providerId)?.label || providers[0].label,
  /** What can actually be controlled for this media (clips override the provider default). */
  capabilitiesFor(providerId, params) {
    const p = this.get(providerId);
    if (!p) return null;
    return (p.paramsCaps && p.paramsCaps(params)) || p.capabilities;
  },
};

export default providerRegistry;
