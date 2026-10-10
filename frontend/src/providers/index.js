// Frontend provider registry (data only: no React, no network).
//
// Each provider describes how to recognise and build media references. The room, context and
// socket layers only ever call these functions, so they never mention a specific provider.
// To add a provider: add a descriptor here and a player component in components/Player/PlayerHost.jsx.
// ONLY providers with a verified, permitted integration mechanism may be added (no DRM or login
// circumvention; Netflix/Prime/Disney+ are intentionally absent).
import { extractYouTubeId } from "../utils/youtube";

const youtube = Object.freeze({
  id: "youtube",
  label: "YouTube",
  placeholder: "Paste a YouTube link or video ID…",
  /** -> media id | null */
  parse: extractYouTubeId,
  urlFor: (mediaId) => `https://www.youtube.com/watch?v=${mediaId}`,
});

const providers = [youtube];

export const providerRegistry = {
  get: (id) => providers.find((p) => p.id === id) || null,
  list: () => providers,
  /** First provider that recognises the input -> { provider, mediaId } | null. */
  resolve(input) {
    for (const p of providers) {
      const mediaId = p.parse(input);
      if (mediaId) return { provider: p.id, mediaId };
    }
    return null;
  },
  urlFor(providerId, mediaId) {
    const p = providerId ? this.get(providerId) : providers[0];
    return p && mediaId ? p.urlFor(mediaId) : "";
  },
  labelFor: (providerId) => providerRegistry.get(providerId)?.label || providers[0].label,
};

export default providerRegistry;
