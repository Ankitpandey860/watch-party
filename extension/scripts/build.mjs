// Bundles the extension into dist/ (load that folder via chrome://extensions -> "Load unpacked").
//   npm run build        production build (Netflix only)
//   npm run build:test   test build: ALSO trusts WP_MOCK_ORIGIN (a local mock page) — never ship this one
import { build } from "esbuild";
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, process.env.WP_OUT_DIR || "dist");
const isTest = process.env.WP_BUILD_TEST === "1";
const mockOrigin = isTest ? (process.env.WP_MOCK_ORIGIN || "http://127.0.0.1:4101") : "";
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true, format: "iife", target: "chrome116", legalComments: "none", logLevel: "warning",
  define: { __WP_MOCK_ORIGIN__: JSON.stringify(mockOrigin) },
};
await Promise.all([
  build({ ...common, entryPoints: [join(root, "src/background/index.js")], outfile: join(dist, "background.js") }),
  build({ ...common, entryPoints: [join(root, "src/content/index.js")], outfile: join(dist, "content.js") }),
  build({ ...common, entryPoints: [join(root, "src/content/netflixMain.js")], outfile: join(dist, "netflix-main.js") }),
  build({ ...common, entryPoints: [join(root, "src/popup/popup.js")], outfile: join(dist, "popup.js") }),
]);
await cp(join(root, "static"), dist, { recursive: true });

const manifest = JSON.parse(await readFile(join(root, "manifest.template.json"), "utf8"));
manifest.version = pkg.version;
if (isTest) {
  manifest.name += " (TEST BUILD)";
  for (const cs of manifest.content_scripts) cs.matches.push(`${mockOrigin}/*`);
  manifest.host_permissions.push(`${mockOrigin}/*`, "http://127.0.0.1/*", "http://localhost/*"); // test builds pair without a prompt
}
await writeFile(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`built ${isTest ? "TEST" : "production"} extension v${pkg.version} -> ${dist}`);
