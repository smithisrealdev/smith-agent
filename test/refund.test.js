import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, makeStore } from "../src/db.js";
import { REFUND } from "../src/config.js";

function setup() {
  let t = Date.parse("2026-11-20T03:00:00Z");
  const store = makeStore(openDb(":memory:"), { startCredit: 500, now: () => new Date((t += 60e3)) });
  store.user("u");
  const done = () => {
    const j = store.addQuote("u", "x", { doable: true, reason: "", title: "t", steps: [], size: "M", cost: 0 });
    store.start("u", j.id);
    store.finish(j.id, { ok: true, answer: "a", usage: { cost: 1 } });
    return j.id;
  };
  return { store, done };
}

test("a wrong-price claim has its own allowance, apart from the 3 a month for other complaints", () => {
  const { store, done } = setup();
  for (let i = 0; i < REFUND.autoPerMonth; i++) assert.equal(store.refund("u", done(), "ไม่ตรง").result, "refunded");
  assert.equal(store.refund("u", done(), "ไม่ตรง").result, "review", "the 4th ordinary claim waits for a person");
  for (let i = 0; i < REFUND.priceAutoPerMonth; i++) assert.equal(store.refund("u", done(), REFUND.priceReason, { price: true }).result, "refunded", `price claim ${i + 1}`);
  const over = store.refund("u", done(), REFUND.priceReason, { price: true });
  assert.equal(over.result, "review", "past its own allowance a price claim also waits for a person");
  assert.equal(over.job.refund_tag, "price", "and it keeps its tag, so it can be put first in the queue");
});

test("price refunds give the money back in full and are tagged; ordinary ones are not", () => {
  const { store, done } = setup();
  const before = store.user("u").credit;
  const a = done();
  const b = done();
  assert.equal(store.refund("u", a, REFUND.priceReason, { price: true }).job.refund_tag, "price");
  assert.equal(store.refund("u", b, "ไม่ใช่สิ่งที่ขอ").job.refund_tag, "");
  assert.equal(store.user("u").credit, before, "both jobs were refunded to the baht");
});
