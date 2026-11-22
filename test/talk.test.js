import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, makeStore } from "../src/db.js";
import { createTalk } from "../src/talk.js";

const answer = (text = "ผมช่วยค้นข้อมูลจากเว็บให้ครับ", cost = 0.02) => async () => ({ kind: "answer", text, cost });
const job = async (past, text) => ({ kind: "task", text: "หาให้ได้ครับ", task: `${text} งบไม่เกิน 3,000`, doable: true, reason: "", title: "หาหูฟัง", steps: ["ค้น Shopee"], size: "M", cost: 0.03 });
function setup(talk, { full = () => false, perHour = 30 } = {}) {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  return { store, talks: createTalk({ store, talk, full, perHour }) };
}

test("an answer is saved with its cost and makes no job", async () => {
  const { store, talks } = setup(answer("ผมช่วยค้นข้อมูลจากเว็บให้ครับ", 0.02));
  const r = await talks.say("u", "  ทำไรได้บ้าง ");
  assert.equal(r.job, null);
  assert.equal(r.reply.text, "ผมช่วยค้นข้อมูลจากเว็บให้ครับ");
  assert.deepEqual(store.talkOf("u").map((e) => [e.role, e.text, e.job]), [["user", "ทำไรได้บ้าง", null], ["smith", "ผมช่วยค้นข้อมูลจากเว็บให้ครับ", null]]);
  assert.equal(store.jobsOf("u").length, 0);
  assert.equal(store.spentToday().toFixed(2), "0.02");
});

test("the model reads the chat so far", async () => {
  const seen = [];
  const { talks } = setup(async (past, text) => (seen.push(past.map((e) => e.text)), { kind: "answer", text: `ตอบ ${text}`, cost: 0 }));
  await talks.say("u", "หวัดดี");
  await talks.say("u", "ทำไรได้บ้าง");
  assert.deepEqual(seen, [[], ["หวัดดี", "ตอบ หวัดดี"]]);
});

test("a job reply makes a quoted job for the full request, linked from the chat, and its cost is counted once", async () => {
  const { store, talks } = setup(job);
  const r = await talks.say("u", "หาหูฟังตัดเสียง");
  assert.deepEqual([r.job.status, r.job.text, r.job.title, r.job.quote_cost], ["quoted", "หาหูฟังตัดเสียง งบไม่เกิน 3,000", "หาหูฟัง", 0.03]);
  assert.equal(store.talkOf("u").at(-1).job, r.job.id);
  assert.equal(store.spentToday().toFixed(2), "0.03", "the job's quote cost, not counted again on the chat row");
});

test("refusals come before any model call", async () => {
  let calls = 0;
  const counted = async () => (calls++, { kind: "answer", text: "ok", cost: 0 });
  const { talks } = setup(counted, { perHour: 1 });
  assert.deepEqual(await talks.say("u", " "), { error: "text" });
  assert.deepEqual(await talks.say("u", "ก".repeat(1001)), { error: "text" });
  assert.ok((await talks.say("u", "หวัดดี")).reply);
  assert.deepEqual(await talks.say("u", "อีกข้อ"), { error: "rate" });
  const capped = setup(counted, { full: () => true }).talks;
  assert.deepEqual(await capped.say("u", "หวัดดี"), { error: "busy" });
  assert.equal(calls, 1, "only the one allowed message reached the model");
});

test("one message at a time per person", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const reached = [];
  // Only the first message waits, so a missing guard lets the second through and fails the test instead of hanging it.
  const { talks } = setup(async (past, text) => {
    reached.push(text);
    if (text === "q1") await gate;
    return { kind: "answer", text: "ok", cost: 0 };
  });
  const first = talks.say("u", "q1");
  assert.deepEqual(await talks.say("u", "q2"), { error: "talk_busy" });
  assert.ok((await talks.say("v", "คนอื่น")).reply, "another person is not held up");
  release();
  assert.ok((await first).reply);
  assert.deepEqual(reached, ["q1", "คนอื่น"]);
  assert.ok((await talks.say("u", "q3")).reply, "open again once the answer is in");
});

test("the model reads only the chat of the last 3 hours, so an old budget or date never slips into a new job", async () => {
  let t = Date.parse("2026-11-22T05:00:00Z");
  const now = () => new Date(t);
  const store = makeStore(openDb(":memory:"), { startCredit: 20, now });
  const seen = [];
  const talks = createTalk({ store, talk: async (past, text) => (seen.push(past.map((e) => e.text)), { kind: "answer", text: `ตอบ ${text}`, cost: 0 }), full: () => false, now });
  await talks.say("u", "ตั๋วไปเชียงใหม่ ศุกร์นี้ งบ 2,000");
  t += 4 * 3600e3;
  await talks.say("u", "หาโรงแรมถูกๆ");
  t += 3600e3;
  await talks.say("u", "แถวนิมมาน");
  assert.deepEqual(seen, [[], [], ["หาโรงแรมถูกๆ", "ตอบ หาโรงแรมถูกๆ"]]);
});
