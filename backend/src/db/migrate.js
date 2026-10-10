import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

/**
 * Applies every `NNN_name.sql` file in `dir` that has not run yet, in order, each in its own
 * transaction, recording it in `schema_migrations`. Returns the list of newly applied names.
 */
export async function runMigrations(db, dir = MIGRATIONS_DIR, log = () => {}) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const done = new Set((await db.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    await db.tx(async (q) => {
      await q.exec(sql);
      await q.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    log(`applied ${file}`);
    applied.push(file);
  }
  return applied;
}
