import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, makeStore } from "../src/db.js";
import { stats, formatStats, formatJobs } from "../src/stats.js";

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
