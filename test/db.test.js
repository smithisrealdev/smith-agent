import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, makeStore } from "../src/db.js";

test("a database made by an earlier version gets the newer columns in place", () => {
  const path = join(mkdtempSync(join(tmpdir(), "smith-")), "old.db");
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL)");
  old.exec("INSERT INTO jobs (user_id, text, status) VALUES ('u', 'kept', 'done')");
  old.close();
  const db = openDb(path);
  const cols = db.prepare("PRAGMA table_info(jobs)").all().map((c) => c.name);
  for (const col of ["refund_reason", "refund_tag", "options", "codes", "coverage"]) assert.ok(cols.includes(col), col);
  assert.equal(db.prepare("SELECT text FROM jobs").get().text, "kept", "existing rows are untouched");
  openDb(path); // running it again is harmless
});

test("what was spent today counts from midnight in Thailand, not from midnight UTC", () => {
  let t = Date.parse("2026-11-20T16:59:00Z"); // 23:59 on the 20th in Bangkok
  const store = makeStore(openDb(":memory:"), { startCredit: 20, now: () => new Date(t) });
  store.user("u");
  const quote = (cost) => store.addQuote("u", "x", { doable: true, title: "t", steps: [], size: "M", cost });
  quote(2);
  assert.equal(store.spentToday(), 2);
  t = Date.parse("2026-11-20T17:01:00Z"); // 00:01 on the 21st in Bangkok, still the 20th in UTC
  assert.equal(store.spentToday(), 0, "a new day has started");
  const job = quote(3);
  store.start("u", job.id);
  store.finish(job.id, { ok: true, answer: "a", usage: { cost: 4 } });
  assert.equal(store.spentToday(), 7, "the quote and the run both count");
});

test("a top-up is credited only when staff approve it, once; a turned-down one adds nothing; deleting the account removes it", () => {
  const store = makeStore(openDb(":memory:"), { startCredit: 9 });
  const t = store.requestTopup("U1", 50);
  assert.equal(store.user("U1").credit, 9);
  assert.equal(store.pendingTopups().length, 1);
  const ok = store.decideTopup(t.id, true);
  assert.equal(ok.status, "approved");
  assert.equal(ok.credit, 59);
  assert.equal(store.decideTopup(t.id, true), null, "approving twice does not pay twice");
  assert.equal(store.user("U1").credit, 59);
  assert.equal(store.ledgerOf("U1")[0].kind, "topup");
  const no = store.requestTopup("U1", 50);
  assert.notEqual(no.id, t.id, "a decided request does not block a new one");
  assert.equal(store.decideTopup(no.id, false).status, "rejected");
  assert.equal(store.user("U1").credit, 59);
  store.deleteUser("U1");
  assert.equal(store.topupsOf("U1").length, 0);
});
