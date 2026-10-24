import { youtubeProvider } from "./youtube.js";
import { vimeoProvider } from "./vimeo.js";
import { twitchProvider } from "./twitch.js";
import { netflixProvider } from "./netflix.js";

/**
 * Provider registry. Room/playback code only ever calls resolveMedia(); it never mentions a
 * specific provider. A new provider = a new descriptor { id, label, mode, parse(input, opts), explain? }
 * registered here, with no change to RoomManager, handlers or the socket layer.
 * Only providers with a verified, permitted integration mechanism may be registered.
 *
 * mode: "embedded"  - the provider's own embeddable player runs inside our page
 *       "companion" - plays in the user's own tab (Netflix), controlled through our browser extension
 */
export function createProviderRegistry(initial = []) {
  const providers = new Map();
  const registry = {
    register(provider) {
      if (!provider?.id || typeof provider.parse !== "function") throw new Error("invalid provider");
      providers.set(provider.id, provider);
      return registry;
    },
    get: (id) => providers.get(id) || null,
    list: () => [...providers.values()],
    /**
     * Resolves user input to { provider, mediaId, params }. With `hint` (an explicit provider id) only
     * that provider is tried, which also makes bare ids unambiguous. Returns null when nothing accepts it.
     */
    resolveMedia(input, hint) {
      if (hint !== undefined && hint !== null) {
        const p = typeof hint === "string" ? providers.get(hint) : null;
        const parsed = p ? p.parse(input, { explicit: true }) : null;
        return parsed ? { provider: p.id, mediaId: parsed.mediaId, params: parsed.params || {} } : null;
      }
      for (const provider of providers.values()) {
        const parsed = provider.parse(input, { explicit: false });
        if (parsed) return { provider: provider.id, mediaId: parsed.mediaId, params: parsed.params || {} };
      }
      return null;
    },
    /** A human-readable reason a given input was refused (for the error message). */
    explain(input, hint) {
      const p = typeof hint === "string" ? providers.get(hint) : null;
      if (p?.explain) return p.explain(input);
      if (!p) {
        for (const q of providers.values()) {
          const msg = q.explain?.(input);
          if (msg && /Live Twitch/.test(msg)) return msg; // a recognised-but-unsupported input beats a generic message
        }
      }
      return "That doesn't look like a supported video link or ID.";
    },
  };
  initial.forEach((p) => registry.register(p));
  return registry;
}

export const providerRegistry = createProviderRegistry([youtubeProvider, vimeoProvider, twitchProvider, netflixProvider]);
