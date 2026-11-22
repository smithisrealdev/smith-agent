import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, makeStore } from "../src/db.js";
import { createChat, CHAT_LIMIT } from "../src/chat.js";

const Q = { doable: true, reason: "", title: "หาหูฟัง", steps: ["ค้น"], size: "M", cost: 0.2 };
function setup(chat, { full = () => false } = {}) {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const u = store.user("u").id;
  const job = store.addQuote(u, "หาหูฟัง", Q);
  store.start(u, job.id);
  store.finish(job.id, { ok: true, answer: "ร้าน B ถูกสุด", sources: [] });
  return { store, job, chats: createChat({ store, chat, full }) };
}
const answer = (text = "ok", cost = 0) => async () => ({ kind: "answer", text, title: "", steps: [], size: "S", cost });

test("ask saves the question and the answer, and counts what the answer cost", async () => {
  const { store, job, chats } = setup(answer("ร้าน B ส่งฟรี", 0.3));
  const r = await chats.ask(job.id, "  ร้านไหนส่งฟรี ");
  assert.deepEqual(JSON.parse(r.job.chat).map((e) => [e.role, e.text]), [["user", "ร้านไหนส่งฟรี"], ["smith", "ร้าน B ส่งฟรี"]]);
  assert.equal(r.reply.text, "ร้าน B ส่งฟรี");
  assert.equal(chats.left(r.job), CHAT_LIMIT - 1);
  assert.equal(store.job(job.id).quote_cost.toFixed(1), "0.5", "the quote's 0.2 plus the answer's 0.3");
});

test("ask refuses what the rules do not allow, before any model call", async () => {
  let calls = 0;
  const { store, job, chats } = setup(async () => (calls++, { kind: "answer", text: "ok", title: "", steps: [], size: "S", cost: 0 }));
  const quoted = store.addQuote("u", "x", Q);
  assert.deepEqual(await chats.ask(quoted.id, "x"), { error: "status" });
  assert.deepEqual(await chats.ask(999, "x"), { error: "status" });
  assert.deepEqual(await chats.ask(job.id, " "), { error: "text" });
  assert.deepEqual(await chats.ask(job.id, "ก".repeat(501)), { error: "text" });
  store.addChat(job.id, Array.from({ length: CHAT_LIMIT }, () => ({ role: "user", text: "q" })));
  assert.deepEqual(await chats.ask(job.id, "x"), { error: "limit" });
  assert.equal(calls, 0);
});

test("the daily cost cap stops chat", async () => {
  const { store, job, chats } = setup(answer());
  const capped = createChat({ store, chat: answer(), full: () => true });
  assert.deepEqual(await capped.ask(job.id, "x"), { error: "busy" });
  assert.ok((await chats.ask(job.id, "x")).job, "open when under the cap");
});

test("one question at a time per job: a second one is turned away and never reaches the model", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  let calls = 0;
  // A second call that reaches the model opens the gate, so a missing guard fails the test instead of hanging it.
  const { job, chats } = setup(async () => (++calls > 1 && release(), await gate, { kind: "answer", text: "ok", title: "", steps: [], size: "S", cost: 0 }));
  const first = chats.ask(job.id, "q1");
  assert.deepEqual(await chats.ask(job.id, "q2"), { error: "chat_busy" });
  release();
  assert.ok((await first).job);
  assert.equal(calls, 1);
  assert.ok((await chats.ask(job.id, "q3")).job, "open again once the first answer is in");
});

test("a search reply makes the free follow-up card, linked from the chat", async () => {
  const { store, job, chats } = setup(async () => ({ kind: "search", text: "จะค้นใหม่", title: "หาถูกกว่า", steps: ["ค้น"], size: "M", cost: 0 }));
  const r = await chats.ask(job.id, "หาถูกกว่านี้");
  assert.deepEqual([r.kid.status, r.kid.price, r.kid.parent_id], ["quoted", 0, job.id]);
  assert.equal(JSON.parse(r.job.chat).at(-1).job, r.kid.id);
  assert.match(store.job(r.kid.id).text, /รอบนี้: หาถูกกว่านี้/);
});
