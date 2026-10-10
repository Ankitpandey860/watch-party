// Minimal database layer. Everything above this file only uses:
//   db.query(text, params) -> { rows, rowCount }
//   db.tx(async (q) => { ... })  where q has .query() and .exec(multiStatementSql) (migrations)
//   db.end()
// Production uses node-postgres against Neon/Postgres. Local development can use an
// embedded Postgres (PGlite, a devDependency) with DATABASE_URL=pglite://memory or pglite://./.data/dev.
import pg from "pg";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

function wrapPool(pool) {
  return {
    kind: "pg",
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (t, p) => client.query(t, p), exec: (t) => client.query(t) });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch { /* connection already broken */ }
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}

export function wrapPglite(pglite) {
  const run = async (target, text, params) => {
    const r = await target.query(text, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  return {
    kind: "pglite",
    query: (text, params) => run(pglite, text, params),
    tx: (fn) => pglite.transaction((t) => fn({ query: (text, params) => run(t, text, params), exec: (text) => t.exec(text) })),
    end: () => pglite.close(),
  };
}

export async function createDb(connectionString) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  if (connectionString.startsWith("pglite://")) {
    let PGlite;
    try {
      ({ PGlite } = await import("@electric-sql/pglite"));
    } catch {
      throw new Error("pglite:// URLs need the dev dependency @electric-sql/pglite (run `npm install`, not `npm ci --omit=dev`).");
    }
    const target = connectionString.slice("pglite://".length);
    if (target === "memory" || !target) return wrapPglite(new PGlite());
    mkdirSync(dirname(target), { recursive: true }); // pglite://./.data/dev must work on a fresh clone
    return wrapPglite(new PGlite(target));
  }
  const pool = new pg.Pool({
    connectionString,
    max: 5, // small on purpose: Neon free has connection limits and we run one instance
    idleTimeoutMillis: 30_000,
    // Neon suspends idle compute after ~5 minutes; the first query afterwards takes a few seconds.
    connectionTimeoutMillis: 20_000,
  });
  pool.on("error", () => { /* idle-client errors must not crash the process */ });
  return wrapPool(pool);
}
