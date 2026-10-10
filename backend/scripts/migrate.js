// Usage: npm run migrate   (reads DATABASE_URL from the environment or .env)
import { config } from "../src/config/env.js";
import { createDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";

try {
  const db = await createDb(config.databaseUrl);
  const applied = await runMigrations(db, undefined, (m) => console.log(`[migrate] ${m}`));
  console.log(applied.length ? `[migrate] done (${applied.length} applied)` : "[migrate] database already up to date");
  await db.end();
} catch (err) {
  console.error(`[migrate] failed: ${err.message}`); // message only: never print the connection string
  process.exit(1);
}
