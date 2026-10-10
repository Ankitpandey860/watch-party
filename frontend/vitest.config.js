// Test-only Vite config. Deliberately separate from vite.config.ts: that file loads the
// TanStack Start + Nitro plugins (SSR build tooling) which must not run under test.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.test.{js,jsx,ts,tsx}"],
    css: false,
    restoreMocks: true,
  },
});
