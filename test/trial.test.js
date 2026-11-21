import { test } from "node:test";
import assert from "node:assert/strict";
import { TASKS, MAX_TASKS, suggestPrice, runOne, summarize, formatRow, formatSummary } from "../src/trial.js";

const quote = (size = "M", cost = 0.3) => async () => ({ doable: true, reason: "", title: "t", steps: ["a"], size, cost });
const ran = (over = {}) => async () => ({
  ok: true, answer: "ถูกสุดร้าน B ฿8,990", usage: { cost: 5 }, codes: [{}], options: [{}, {}],
  coverage: { searches: 3, pages: 4, hosts: ["a.example", "b.example"], blocked: ["shopee.example"] }, ...over,
});

test("a trial task gives its cost (quote and run), what it opened, and what it could not read", async () => {
  const row = await runOne("เทียบราคา", { quote: quote("M", 0.3), runTask: ran() });
  assert.equal(row.ok, true);
  assert.equal(row.cost, 5.3);
  assert.deepEqual([row.size, row.searches, row.pages, row.codes, row.options], ["M", 3, 4, 1, 2]);
  assert.deepEqual(row.blocked, ["shopee.example"]);
  assert.match(formatRow(row, 0), /^1\. สำเร็จ · M · ต้นทุน ฿5\.30 · \d+ วินาที · ค้น 3 อ่าน 4 หน้า · อ่านไม่ได้: shopee\.example · โค้ด 1/);
});

test("a task that cannot be done, fails, or throws is counted as a failure and keeps its cost", async () => {
  const no = await runOne("โอนเงิน", { quote: async () => ({ doable: false, reason: "ต้องล็อกอินธนาคาร", cost: 0.2 }), runTask: ran() });
  assert.deepEqual([no.ok, no.cost, no.note], [false, 0.2, "ทำไม่ได้: ต้องล็อกอินธนาคาร"]);
  const failed = await runOne("x", { quote: quote(), runTask: ran({ ok: false, error: "no report", answer: "", coverage: undefined, usage: { cost: 2 }, codes: undefined, options: undefined }) });
  assert.deepEqual([failed.ok, failed.cost, failed.note, failed.searches], [false, 2.3, "no report", 0]);
  const boom = await runOne("x", { quote: quote(), runTask: async () => { throw new Error("429 rate limited"); } });
  assert.equal(boom.ok, false);
  assert.match(boom.note, /ระบบขัดข้อง: 429 rate limited/);
  assert.equal(boom.cost, 0.3, "the quote was already paid for");
});

test("the price rule picks the cheapest price whose revenue, after store fees, carries the cost at 72% paid", () => {
  assert.equal(suggestPrice(4), 9, "up to about 5.15 a job, 9 baht is enough");
  assert.equal(suggestPrice(6), 12);
  assert.equal(suggestPrice(8), 15);
  assert.equal(suggestPrice(11), 20);
  assert.equal(suggestPrice(12), null, "no price in the range carries it");
});

test("the summary averages cost, uses medium jobs only when there are enough, and ranks the sites", async () => {
  const rows = [];
  for (const [size, cost, blocked] of [["M", 4, ["shopee.example"]], ["M", 6, ["shopee.example", "lazada.example"]], ["M", 8, []], ["S", 2, []]]) {
    rows.push(await runOne("x", { quote: quote(size, 0), runTask: ran({ usage: { cost }, coverage: { searches: 1, pages: 1, hosts: ["a.example"], blocked } }) }));
  }
  const s = summarize(rows);
  assert.deepEqual([s.n, s.ok, s.total, s.avg, s.avgM], [4, 4, 20, 5, 6]);
  assert.deepEqual(s.blocked, [["shopee.example", 2], ["lazada.example", 1]]);
  assert.equal(s.price, 12, "medium jobs average 6 baht: 12 baht is the first price that carries it");
  assert.match(formatSummary(s), /เว็บที่อ่านไม่ได้: shopee\.example ×2, lazada\.example ×1/);
  assert.match(formatSummary(s), /ราคางานกลางที่ควรใช้ตามกฎใน founder\/pricing\.md: ฿12/);
  const few = summarize(rows.slice(2));
  assert.equal(few.avgM, null, "one medium job is not an average");
  assert.match(formatSummary(few), /น้อยกว่า 3 งาน/);
  assert.match(formatSummary(summarize([await runOne("x", { quote: quote("M", 0), runTask: ran({ usage: { cost: 30 } }) })])), /ต้องลดต้นทุนก่อน/);
});

test("the built-in tasks are a small, bounded list that includes the big Thai marketplaces", () => {
  assert.ok(TASKS.length <= MAX_TASKS);
  assert.ok(TASKS.some((t) => /Shopee/.test(t)) && TASKS.some((t) => /Lazada/.test(t)));
  assert.equal(new Set(TASKS).size, TASKS.length);
});

test("when no task got as far as running, the summary gives no price and says what to check", async () => {
  const rows = [await runOne("x", { quote: async () => { throw new Error("no key"); }, runTask: ran() }), await runOne("y", { quote: async () => ({ doable: false, reason: "ต้องล็อกอิน", cost: 0.2 }), runTask: ran() })];
  const s = summarize(rows);
  assert.equal(s.ran, 0);
  assert.equal(s.price, null);
  assert.match(formatSummary(s), /ยังบอกราคาไม่ได้: ไม่มีงานไหนทำถึงขั้นรัน/);
  assert.doesNotMatch(formatSummary(s), /ราคางานกลางที่ควรใช้/);
});

test("a task turned down at the quote does not pull the average cost per started job down", async () => {
  const rows = [await runOne("x", { quote: quote("M", 0), runTask: ran({ usage: { cost: 8 } }) }), await runOne("y", { quote: async () => ({ doable: false, reason: "ต้องล็อกอิน", cost: 0.2 }), runTask: ran() })];
  assert.equal(summarize(rows).avg, 8);
  assert.equal(summarize(rows).total, 8.2);
});
