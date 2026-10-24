// Builds the production extension and zips dist/ as watch-party-extension-<version>.zip (for sideloading / store upload).
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [join(root, "scripts/build.mjs")], { stdio: "inherit", env: { ...process.env, WP_BUILD_TEST: "0" } });
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const out = join(root, `watch-party-extension-${version}.zip`);
execFileSync("zip", ["-qr", out, "."], { cwd: join(root, "dist") });
console.log(`packaged ${out}`);
