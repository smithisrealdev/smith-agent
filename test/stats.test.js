import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, makeStore } from "../src/db.js";
import { stats, formatStats } from "../src/stats.js";

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
