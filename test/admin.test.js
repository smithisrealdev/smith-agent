import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, makeStore } from "../src/db.js";
import { createAdmin } from "../src/admin.js";

const TOKEN = "t".repeat(40);

async function start({ token = TOKEN, now } = {}) {
  const db = openDb(":memory:");
  const store = makeStore(db, { startCredit: 20 });
  store.user("a");
  const backupDir = mkdtempSync(join(tmpdir(), "smith-"));
  const admin = createAdmin({ db, token, backupDir, now, log: { log() {} } });
  const server = createServer(async (req, res) => {
    if (await admin(req, res)) return;
    res.writeHead(404).end("other");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, headers = {}, method = "GET") => fetch(base + path, { method, headers });
  return { get, backupDir, close: () => server.close() };
}

test("the staff download is off unless a token is set, and only answers GET /admin/backup", async (t) => {
  const off = await start({ token: "" });
  t.after(off.close);
  assert.equal((await off.get("/admin/backup", { Authorization: `Bearer ${TOKEN}` })).status, 404, "off: even a header changes nothing");
  const on = await start();
  t.after(on.close);
  assert.equal((await on.get("/admin/backup", { Authorization: `Bearer ${TOKEN}` }, "POST")).status, 404);
  assert.equal((await on.get(`/admin/backup?token=${TOKEN}`)).status, 404, "a token in the URL is not accepted");
  assert.equal((await on.get("/admin/other", { Authorization: `Bearer ${TOKEN}` })).status, 404);
  assert.equal(await (await on.get("/healthz")).text(), "other", "everything else is left to the rest of the server");
});

test("without the right token there is no download", async (t) => {
  const s = await start();
  t.after(s.close);
  assert.equal((await s.get("/admin/backup")).status, 401);
  assert.equal((await s.get("/admin/backup", { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await s.get("/admin/backup", { Authorization: TOKEN })).status, 401, "it must say Bearer");
  assert.equal((await s.get("/admin/backup", { Authorization: `Bearer ${TOKEN}x` })).status, 401);
});

test("the right token downloads a working copy of the database, and nothing is left behind on the server", async (t) => {
  const s = await start();
  t.after(s.close);
  const res = await s.get("/admin/backup", { Authorization: `Bearer ${TOKEN}` });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /^attachment; filename="smith-\d{4}-\d{2}-\d{2}-[0-9a-f]{6}\.db"$/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString("latin1"), "SQLite format 3", "a real SQLite file");
  const file = join(mkdtempSync(join(tmpdir(), "smith-")), "got.db");
  writeFileSync(file, bytes);
  const copy = new DatabaseSync(file, { readOnly: true });
  assert.equal(copy.prepare("SELECT credit FROM users WHERE id = 'a'").get().credit, 20);
  copy.close();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(readdirSync(join(s.backupDir, "download")), [], "the temporary copy is deleted after the download");
  assert.equal((await s.get("/admin/backup", { Authorization: `Bearer ${TOKEN}` })).status, 200, "and it can be done again");
});

test("ten wrong tokens lock the route for ten minutes, even for the right token", async (t) => {
  let clock = Date.parse("2026-11-21T03:00:00Z");
  const s = await start({ now: () => clock });
  t.after(s.close);
  for (let i = 0; i < 10; i++) assert.equal((await s.get("/admin/backup", { Authorization: "Bearer guess" + i })).status, 401);
  assert.equal((await s.get("/admin/backup", { Authorization: `Bearer ${TOKEN}` })).status, 429);
  clock += 11 * 60e3;
  assert.equal((await s.get("/admin/backup", { Authorization: `Bearer ${TOKEN}` })).status, 200, "unlocked after ten minutes");
});
