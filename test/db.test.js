import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db.js";

test("a database made by an earlier version gets the newer columns in place", () => {
  const path = join(mkdtempSync(join(tmpdir(), "smith-")), "old.db");
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL)");
  old.exec("INSERT INTO jobs (user_id, text, status) VALUES ('u', 'kept', 'done')");
  old.close();
  const db = openDb(path);
  const cols = db.prepare("PRAGMA table_info(jobs)").all().map((c) => c.name);
  assert.ok(cols.includes("refund_reason") && cols.includes("options"));
  assert.equal(db.prepare("SELECT text FROM jobs").get().text, "kept", "existing rows are untouched");
  openDb(path); // running it again is harmless
});
