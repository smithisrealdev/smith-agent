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
  for (const col of ["refund_reason", "refund_tag", "options", "codes", "coverage", "chat", "parent_id"]) assert.ok(cols.includes(col), col);
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

const Q = { doable: true, reason: "", title: "หาหูฟัง", steps: ["ค้น"], size: "M", cost: 0.5 };
const AGAIN = { title: "ค้นใหม่", steps: ["ค้น"], size: "M" };

test("a re-search is free once per original job, never from a follow-up, and a free one moves no credit", () => {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const u = store.user("u").id;
  const root = store.addQuote(u, "หาหูฟัง", Q);
  store.start(u, root.id);
  store.finish(root.id, { ok: true, answer: "A", sources: [] });
  const a = store.addFollowUp(root.id, "หาหูฟัง\n\nรอบนี้: สีดำ", AGAIN);
  assert.deepEqual([a.status, a.price, a.parent_id], ["quoted", 0, root.id]);
  const b = store.addFollowUp(root.id, "หาหูฟัง\n\nรอบนี้: สีขาว", AGAIN);
  assert.equal(b.price, 0, "still free while none has started");
  assert.equal(store.job(a.id).status, "cancelled", "only the newest free card can start");
  const credit = store.user(u).credit;
  assert.equal(store.start(u, b.id).ok, true);
  store.finish(b.id, { ok: false, summary: "ไม่เจอ", sources: [] });
  assert.equal(store.user(u).credit, credit, "a free job holds and returns nothing");
  assert.equal(store.ledgerOf(u).filter((l) => l.job_id === b.id).length, 0, "and writes no ฿0 rows");
  const c = store.addFollowUp(root.id, "x", AGAIN);
  assert.equal(c.price, 0, "a free re-search that failed leaves the free try");
  store.start(u, c.id);
  store.finish(c.id, { ok: true, answer: "C", sources: [] });
  assert.equal(store.addFollowUp(root.id, "x", AGAIN).price, 9, "the free try is used once one has run");
  assert.equal(store.addFollowUp(b.id, "x", AGAIN).price, 9, "a follow-up of a follow-up is never free");
});

test("chat entries append in order, and their cost counts as the job's quote cost", () => {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const j = store.addQuote(store.user("u").id, "x", Q);
  store.addChat(j.id, [{ role: "user", text: "ถาม", at: "t1" }, { role: "smith", text: "ตอบ", at: "t1" }], 0.2);
  const k = store.addChat(j.id, [{ role: "user", text: "อีก", at: "t2" }]);
  assert.deepEqual(JSON.parse(k.chat).map((m) => m.text), ["ถาม", "ตอบ", "อีก"]);
  assert.equal(k.quote_cost.toFixed(2), "0.70");
});

test("a free re-search has nothing to refund: no ฿0 refund row, and no monthly refund used up", () => {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const u = store.user("u").id;
  const root = store.addQuote(u, "x", Q);
  store.start(u, root.id);
  store.finish(root.id, { ok: true, answer: "A", sources: [] });
  const free = store.addFollowUp(root.id, "x\n\nรอบนี้: y", AGAIN);
  store.start(u, free.id);
  store.finish(free.id, { ok: true, answer: "B", sources: [] });
  assert.equal(store.refund(u, free.id, "ไม่ตรง").result, "not_charged");
  assert.equal(store.forceRefund(free.id), false);
  assert.equal(store.job(free.id).status, "done");
  assert.equal(store.ledgerOf(u).filter((l) => l.job_id === free.id).length, 0);
});

// ---------- chat before a job
const talkStore = () => {
  let t = Date.parse("2026-11-22T05:00:00Z");
  return { store: makeStore(openDb(":memory:"), { startCredit: 20, now: () => new Date(t) }), later: (min) => (t += min * 60e3) };
};

test("chat before a job: kept per user, oldest first, the last ones on request, only the user's messages counted", () => {
  const { store, later } = talkStore();
  store.addTalk("u", [{ role: "user", text: "q1" }, { role: "smith", text: "a1" }], 0.02);
  later(1);
  store.addTalk("u", [{ role: "user", text: "q2" }, { role: "smith", text: "งานนี้", job: 7 }]);
  store.addTalk("v", [{ role: "user", text: "other" }, { role: "smith", text: "x" }]);
  assert.deepEqual(store.talkOf("u").map((e) => [e.role, e.text, e.job]), [["user", "q1", null], ["smith", "a1", null], ["user", "q2", null], ["smith", "งานนี้", 7]]);
  assert.deepEqual(store.talkOf("u", 2).map((e) => e.text), ["q2", "งานนี้"]);
  assert.equal(store.talkOf("u")[0].at, "2026-11-22T05:00:00.000Z");
  assert.equal(store.talksSince("u", "2026-11-22T04:00:00.000Z"), 2);
  assert.equal(store.talksSince("u", "2026-11-22T05:00:30.000Z"), 1);
  assert.equal(store.talksSince("u", "2026-11-22T06:00:00.000Z"), 0);
});

test("an answer's model cost counts toward today's spend", () => {
  const { store } = talkStore();
  const before = store.spentToday();
  store.addTalk("u", [{ role: "user", text: "ทำไรได้บ้าง" }, { role: "smith", text: "ค้นเว็บให้" }], 0.5);
  assert.equal(store.spentToday() - before, 0.5);
});

test("deleting an account deletes its chat before a job", () => {
  const { store } = talkStore();
  store.user("u");
  store.addTalk("u", [{ role: "user", text: "q" }, { role: "smith", text: "a" }]);
  store.addTalk("v", [{ role: "user", text: "q" }, { role: "smith", text: "a" }]);
  store.deleteUser("u");
  assert.deepEqual(store.talkOf("u"), []);
  assert.equal(store.talkOf("v").length, 2);
});

test("a store purchase adds its credit once: the same transaction sent again adds nothing, even after the account is deleted", () => {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const p = { platform: "ios", transactionId: "2000001", productId: "credit_50", credit: 50 };
  assert.deepEqual(store.addPurchase("apple:1", p), { added: 50, credit: 70 });
  assert.deepEqual(store.addPurchase("apple:1", p), { added: 0, credit: 70 }, "sent twice");
  assert.deepEqual(store.addPurchase("apple:1", { ...p, platform: "android" }), { added: 50, credit: 120 }, "ids are per store");
  assert.deepEqual(store.ledgerOf("apple:1").map((e) => [e.kind, e.amount]), [["purchase", 50], ["purchase", 50], ["start", 20]]);
  assert.equal(store.purchase("ios", "2000001").user_id, "apple:1");
  store.deleteUser("apple:1");
  assert.equal(store.purchase("ios", "2000001").user_id, "", "the receipt stays spent, without the person");
  assert.deepEqual(store.addPurchase("apple:2", p), { added: 0, credit: 20 });
});

test("push tokens and an Apple refresh token belong to a user and go when the account is deleted", () => {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  store.addPushToken("U1", "ExponentPushToken[a]");
  store.addPushToken("U1", "ExponentPushToken[b]");
  store.addPushToken("U2", "ExponentPushToken[b]"); // the phone signed in as someone else
  assert.deepEqual(store.pushTokensOf("U1"), ["ExponentPushToken[a]"]);
  assert.deepEqual(store.pushTokensOf("U2"), ["ExponentPushToken[b]"]);
  store.dropPushToken("ExponentPushToken[a]");
  assert.deepEqual(store.pushTokensOf("U1"), []);
  store.setAppleToken("apple:1", "rt");
  assert.equal(store.appleToken("apple:1"), "rt");
  store.deleteUser("U2");
  store.deleteUser("apple:1");
  assert.deepEqual(store.pushTokensOf("U2"), []);
  assert.equal(store.appleToken("apple:1"), null);
});
