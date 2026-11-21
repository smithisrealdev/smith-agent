import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, makeStore } from "../src/db.js";
import { backupDb, restoreDb } from "../src/backup.js";

const users = (path) => {
  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    return copy.prepare("SELECT id, credit FROM users ORDER BY id").all().map((u) => [u.id, u.credit]);
  } finally {
    copy.close();
  }
};

test("a backup is a full, separate copy of the database: later changes do not reach it", async () => {
  const db = openDb(":memory:");
  const store = makeStore(db, { startCredit: 20 });
  store.user("a");
  store.user("b");
  store.grant("a", 30);
  const dir = join(mkdtempSync(join(tmpdir(), "smith-")), "backups");
  const file = await backupDb(db, dir, { now: new Date("2026-11-21T03:15:00Z") });
  assert.match(file, /smith-20261121T031500Z\.db$/);
  store.user("c");
  assert.deepEqual(users(file), [["a", 50], ["b", 20]]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 3);
});

test("only the newest copies are kept", async () => {
  const db = openDb(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "smith-"));
  for (const day of ["18", "19", "20", "21"]) await backupDb(db, dir, { keep: 2, now: new Date(`2026-11-${day}T03:00:00Z`) });
  assert.deepEqual(readdirSync(dir), ["smith-20261120T030000Z.db", "smith-20261121T030000Z.db"]);
  await assert.rejects(backupDb(db, dir, { keep: 0 }), /keep must be at least 1/);
});

test("a folder name with a quote in it is not a way to break the statement", async () => {
  const db = openDb(":memory:");
  const dir = join(mkdtempSync(join(tmpdir(), "o'brien-")), "it's here");
  const file = await backupDb(db, dir);
  assert.deepEqual(users(file), []);
});

test("two copies in the same second replace each other instead of failing", async () => {
  const db = openDb(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "smith-"));
  const at = new Date("2026-11-21T03:00:00Z");
  await backupDb(db, dir, { now: at });
  await backupDb(db, dir, { now: at });
  assert.equal(readdirSync(dir).length, 1);
});

test("restoring puts the backup in place, even while a server still has the old database open", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smith-"));
  const path = join(dir, "smith.db");
  const live = openDb(path); // the running server
  const store = makeStore(live, { startCredit: 20 });
  store.user("a");
  store.grant("a", 30);
  const copy = await backupDb(live, join(dir, "backups"));
  store.grant("a", 999); // what happens after the backup, and is meant to be lost
  store.user("b");
  await restoreDb(copy, path);
  assert.equal(existsSync(`${path}-wal`), false, "the old write-ahead file is gone");
  store.user("c"); // the still-running server writes on, into the file it had open
  const restored = openDb(path);
  assert.deepEqual(users(path), [["a", 50]], "the restored database has only what the backup had");
  assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  restored.close();
  assert.equal(existsSync(`${path}.restore`), false, "no staging file left behind");
});

test("restore refuses a damaged file, a file that is not a Smith database, and restoring a file onto itself", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smith-"));
  const path = join(dir, "smith.db");
  openDb(path).close();
  const garbage = join(dir, "garbage.db");
  writeFileSync(garbage, "this is not a database, just text ".repeat(50));
  await assert.rejects(restoreDb(garbage, path));
  const other = join(dir, "other.db");
  const o = new DatabaseSync(other);
  o.exec("CREATE TABLE notes (x TEXT)");
  o.close();
  await assert.rejects(restoreDb(other, path), /not a Smith database: it has no users table/);
  await assert.rejects(restoreDb(path, path), /same file/);
  assert.deepEqual(users(path), [], "the live database was left alone every time");
});
