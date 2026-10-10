import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../src/db/index.js";

test("pglite:// with a not-yet-existing parent directory is created on demand (fresh clone)", async () => {
  const base = mkdtempSync(join(tmpdir(), "wp-db-"));
  const db = await createDb(`pglite://${join(base, "nested", "dev")}`);
  assert.equal((await db.query("SELECT 1 AS one")).rows[0].one, 1);
  assert.ok(existsSync(join(base, "nested")));
  await db.end();
});
