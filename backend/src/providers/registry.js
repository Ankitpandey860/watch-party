import { youtubeProvider } from "./youtube.js";

/**
 * Provider registry. Room/playback code only ever calls resolveMedia(); it never mentions a
 * specific provider. A new provider = a new descriptor { id, label, parse(input) } registered
 * here, with no change to RoomManager, handlers or the socket layer.
 * Only providers with a verified, permitted integration mechanism may be registered.
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
    /** First provider that accepts the input wins -> { provider, mediaId } | null. */
    resolveMedia(input) {
      for (const provider of providers.values()) {
        const parsed = provider.parse(input);
        if (parsed) return { provider: provider.id, mediaId: parsed.mediaId };
      }
      return null;
    },
  };
  initial.forEach((p) => registry.register(p));
  return registry;
}

export const providerRegistry = createProviderRegistry([youtubeProvider]);
