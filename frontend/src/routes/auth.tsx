import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "../pages/Auth/AuthPage";

// Only same-site relative paths are accepted as a post-login destination (no open redirects).
const safePath = (v: unknown) =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : "/";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: safePath(search.returnTo),
    error: typeof search.error === "string" ? search.error.slice(0, 40) : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in — Watchly" }, { name: "robots", content: "noindex" }] }),
  component: AuthPage,
});
