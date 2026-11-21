import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, makeStore } from "../src/db.js";
import { stats, formatStats, formatJobs, formatQueue } from "../src/stats.js";
import { REFUND } from "../src/config.js";

test("stats measure success, refunds, cost against price, and repeat use", () => {
  let t = Date.parse("2026-11-20T03:00:00Z");
  const db = openDb(":memory:");
  const store = makeStore(db, { startCredit: 50, now: () => new Date((t += 60e3)) });
  const q = (size, cost = 0.2) => ({ doable: true, reason: "", title: "t", steps: [], size, cost });
  const job = (user, size, result) => {
    store.user(user);
    const j = store.addQuote(user, "x", q(size));
    store.start(user, j.id);
    store.finish(j.id, result);
    return j.id;
  };
  job("a", "M", { ok: true, answer: "ok", usage: { cost: 5 } });
  const refunded = job("a", "M", { ok: true, answer: "ok", usage: { cost: 6 } });
  store.refund("a", refunded);
  job("b", "L", { ok: false, usage: { cost: 3 } });
  store.addQuote("c", "x", { doable: false, reason: "no", cost: 0.1 });

  const s = stats(db);
  assert.equal(s.quotes, 4);
  assert.equal(s.started, 3);
  assert.equal(s.rejected, 1);
  assert.equal(s.successRate, 2 / 3);
  assert.equal(s.refundRate, 1 / 2);
  assert.equal(s.revenue, 9, "only the kept charge counts");
  assert.equal(Number(s.cost.toFixed(2)), Number((0.2 * 3 + 0.1 + 5 + 6 + 3).toFixed(2)));
  assert.equal(s.users, 2);
  assert.equal(s.repeatUsers, 1);
  assert.equal(s.medianSeconds, 60);
  assert.ok(s.marginAfterStoreFee < s.margin);
  assert.match(formatStats(s), /อัตราสำเร็จ 67%/);
});

test("the job list says why each job failed, was refunded or was turned down", () => {
  const db = openDb(":memory:");
  const store = makeStore(db, { startCredit: 50 });
  store.user("a");
  const q = { doable: true, reason: "", title: "หาตั๋ว", steps: [], size: "M", cost: 0.5 };
  const done = store.addQuote("a", "x", q);
  store.start("a", done.id);
  store.finish(done.id, { ok: true, answer: "ok", usage: { cost: 4 } });
  store.refund("a", done.id, "ราคาไม่ตรงกับหน้าเว็บ");
  const failed = store.addQuote("a", "y", { ...q, title: "หาที่พัก" });
  store.start("a", failed.id);
  store.finish(failed.id, { ok: false, error: "LINE token 500", answer: "ระบบขัดข้อง", usage: { cost: 1 } });
  store.addQuote("a", "โอนเงิน", { doable: false, reason: "ต้องล็อกอินธนาคาร", cost: 0.1 });

  const out = formatJobs(db);
  assert.match(out, /^#3 rejected · ราคา ฿0 · ต้นทุน ฿0\.10 · - · โอนเงิน\n    ต้องล็อกอินธนาคาร/);
  assert.match(out, /#2 failed · ราคา ฿9 · ต้นทุน ฿1\.50 · \d+ วินาที · หาที่พัก\n    LINE token 500/);
  assert.match(out, /#1 refunded · ราคา ฿9 · ต้นทุน ฿4\.50 · \d+ วินาที · หาตั๋ว\n    คืนเงิน: ราคาไม่ตรงกับหน้าเว็บ/);
  assert.equal(formatJobs(openDb(":memory:")), "ยังไม่มีงาน");
});

test("stats tell which sites could not be read and how often the price was wrong; the queue puts price claims first", () => {
  let t = Date.parse("2026-11-20T03:00:00Z");
  const db = openDb(":memory:");
  const store = makeStore(db, { startCredit: 100, now: () => new Date((t += 60e3)) });
  const run = (coverage, title = "t") => {
    store.user("a");
    const j = store.addQuote("a", "x", { doable: true, reason: "", title, steps: [], size: "M", cost: 0 });
    store.start("a", j.id);
    store.finish(j.id, { ok: true, answer: "a", usage: { cost: 1 }, coverage, options: [{ name: "n", price: "฿100", note: "", url: "https://a.example/x" }] });
    return j.id;
  };
  const ordinary = run({ searches: 2, pages: 2, hosts: ["a.example", "b.example"], blocked: ["shopee.example"] }, "ordinary");
  const wrongPrice = run({ searches: 1, pages: 1, hosts: ["a.example"], blocked: ["shopee.example", "lazada.example"] }, "wrongPrice");
  run(undefined, "old job without coverage");
  store.refund("a", ordinary, "ไม่ใช่สิ่งที่ขอ");
  store.refund("a", wrongPrice, "ราคาไม่ตรงกับหน้าเว็บ", { price: true });
  const s = stats(db);
  assert.deepEqual(s.blockedHosts, [["shopee.example", 2], ["lazada.example", 1]]);
  assert.deepEqual(s.readHosts[0], ["a.example", 2]);
  assert.equal(s.priceClaims, 1);
  assert.equal(s.priceClaimRate, 1 / 3);
  assert.match(formatStats(s), /เว็บที่อ่านไม่ได้: shopee\.example ×2, lazada\.example ×1/);
});

test("the review queue puts wrong-price claims first, then the rest in order", () => {
  let t = Date.parse("2026-11-20T03:00:00Z");
  const db = openDb(":memory:");
  const store = makeStore(db, { startCredit: 500, now: () => new Date((t += 60e3)) });
  store.user("a");
  const done = (title) => {
    const j = store.addQuote("a", "x", { doable: true, reason: "", title, steps: [], size: "M", cost: 0 });
    store.start("a", j.id);
    store.finish(j.id, { ok: true, answer: "a", usage: { cost: 1 }, options: [{ name: "n", price: "฿100", note: "", url: "https://a.example/x" }] });
    return j.id;
  };
  for (let i = 0; i < REFUND.autoPerMonth; i++) store.refund("a", done("filler"), "x");
  for (let i = 0; i < REFUND.priceAutoPerMonth; i++) store.refund("a", done("filler"), "x", { price: true });
  const ordinary = done("ordinary waiting");
  const price = done("price waiting");
  assert.equal(store.refund("a", ordinary, "ไม่ตรง").result, "review");
  assert.equal(store.refund("a", price, "ราคาไม่ตรงกับหน้าเว็บ", { price: true }).result, "review");
  const lines = formatQueue(db).split("\n").filter((l) => l.startsWith("#"));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\[ราคาไม่ตรง\] price waiting/);
  assert.match(lines[1], /ordinary waiting/);
  assert.match(formatQueue(db), /อนุมัติ: node src\/cli\.js refund \d+/);
  assert.equal(formatQueue(openDb(":memory:")), "ไม่มีคำขอรอตรวจ");
});
