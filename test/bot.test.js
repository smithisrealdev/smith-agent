import { test } from "node:test";
import { createAlerts } from "../src/alerts.js";
import assert from "node:assert/strict";
import { openDb, makeStore } from "../src/db.js";
import { createBot } from "../src/bot.js";
import { createRunner } from "../src/runner.js";
import { createChat } from "../src/chat.js";

const QUOTE_M = { doable: true, reason: "", title: "หาตั๋วไปเชียงใหม่", steps: ["เปิดเว็บสายการบิน", "เทียบราคา"], size: "M", cost: 0.3 };
const RESULT = {
  ok: true, answer: "เที่ยวเช้า 07:05 ฿1,290", summary: "เจอแล้ว",
  sources: [{ title: "Airline A", url: "https://a.example/flight" }], bestUrl: "",
  usage: { cost: 4.2, input_tokens: 9000, output_tokens: 800, searches: 3 },
};

const CHAT_ANSWER = async () => ({ kind: "answer", text: "ร้าน B ส่งฟรี **ครับ**", title: "", steps: [], size: "S", cost: 0 });
// Unless a test says otherwise, every message is a job and is quoted the old way.
function setup({ quote = async () => QUOTE_M, talk = async (past, t) => ({ kind: "task", text: "", task: t, ...(await quote(t)) }), runTask = async () => RESULT, chat = CHAT_ANSWER, clock, publicUrl, dailyCostCap, maxUsers, topup, alerts, refuse = () => false, replyFails = () => false } = {}) {
  let t = clock ?? Date.parse("2026-11-20T03:00:00Z");
  const store = makeStore(openDb(":memory:"), { startCredit: 20, now: () => new Date(t) });
  const sent = [];
  const line = {
    reply: async (token, messages) => {
      if (replyFails(messages)) throw new Error("LINE reply 400: invalid reply token");
      sent.push({ to: "reply", messages });
    },
    push: async (to, messages) => {
      if (refuse(messages)) throw new Error("LINE push 400");
      sent.push({ to, messages });
    },
  };
  const runner = createRunner({ store, runTask, screenshot: async () => false, log: { error() {} } });
  const chats = createChat({ store, chat, full: () => false, now: () => new Date(t) });
  const bot = createBot({ store, line, talk, chats, runner, publicUrl, dailyCostCap, maxUsers, topup, alerts, now: () => new Date(t), log: { error() {} } });
  return { store, bot, runner, chats, sent, later: (hours) => (t += hours * 3600e3) };
}
const say = (userId, text, type = "user") => ({ type: "message", replyToken: "r", source: { type, userId }, message: { type: "text", text } });
const tap = (userId, data) => ({ type: "postback", replyToken: "r", source: { type: "user", userId }, postback: { data } });
const lastText = (sent) => sent.at(-1).messages.at(-1).text;
const actions = (sent) => sent.at(-1).messages.at(-1).quickReply?.items.map((i) => i.action.data);

test("quote first, charge only after a successful run", async () => {
  const { store, bot, sent } = setup();
  await bot.handle(say("u1", "หาตั๋วไปเชียงใหม่ศุกร์นี้"));
  assert.match(lastText(sent), /ราคา ฿9/);
  assert.match(lastText(sent), /ไม่สำเร็จ ไม่คิดเงิน/);
  assert.deepEqual(actions(sent), ["start:1", "cancel:1"]);
  assert.equal(store.user("u1").credit, 20, "quoting costs nothing");

  await bot.handle(tap("u1", "start:1"));
  assert.match(sent.at(-2).messages[0].text, /เริ่มแล้ว/);
  assert.equal(sent.at(-1).to, "u1");
  assert.match(lastText(sent), /เสร็จแล้ว: หาตั๋วไปเชียงใหม่[\s\S]*฿1,290[\s\S]*https:\/\/a\.example\/flight/);
  assert.doesNotMatch(lastText(sent), /ตัวเลือกที่เจอ/, "no options, no options section");
  assert.deepEqual(actions(sent), ["refund:1:price", "refund:1", "ask:1"]);
  assert.equal(store.user("u1").credit, 11);
  const job = store.job(1);
  assert.equal(job.status, "done");
  assert.equal(job.run_cost, 4.2);
  assert.equal(job.quote_cost, 0.3);

  await bot.handle(tap("u1", "start:1"));
  assert.match(lastText(sent), /เริ่มไปแล้ว/);
  assert.equal(store.user("u1").credit, 11, "a second tap does not charge again");
});

test("a failed run gives the credit back", async () => {
  const { store, bot, sent } = setup({ runTask: async () => ({ ok: false, summary: "เว็บสายการบินปิดปรับปรุง", sources: [], usage: { cost: 2 } }) });
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u1", "start:1"));
  assert.match(lastText(sent), /ไม่สำเร็จ ไม่คิดเงิน[\s\S]*ปิดปรับปรุง[\s\S]*เครดิตเท่าเดิม ฿20/);
  assert.equal(store.user("u1").credit, 20);
  assert.equal(store.job(1).status, "failed");
  assert.equal(store.job(1).run_cost, 2, "the cost is still recorded for the experiment");
});

test("an error during the run counts as a failure", async () => {
  const { store, bot, sent } = setup({ runTask: async () => { throw new Error("overloaded"); } });
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u1", "start:1"));
  assert.match(lastText(sent), /ไม่สำเร็จ ไม่คิดเงิน/);
  assert.equal(store.user("u1").credit, 20);
  assert.equal(store.job(1).error, "overloaded");
});

test("not enough credit leaves the job quoted", async () => {
  const { store, bot, sent } = setup({ quote: async () => ({ ...QUOTE_M, size: "L" }) });
  await bot.handle(say("u1", "งานใหญ่ 1"));
  await bot.handle(tap("u1", "start:1"));
  assert.equal(store.user("u1").credit, 5);
  await bot.handle(say("u1", "งานใหญ่ 2"));
  await bot.handle(tap("u1", "start:2"));
  assert.match(lastText(sent), /เครดิตไม่พอ งานนี้ ฿15 คุณมี ฿5/);
  assert.equal(store.job(2).status, "quoted");
  assert.equal(store.user("u1").credit, 5);
});

test("a task Smith cannot do is turned down for free", async () => {
  const { store, bot, sent } = setup({ quote: async () => ({ doable: false, reason: "ต้องล็อกอินธนาคาร", title: "", steps: [], size: "S", cost: 0.1 }) });
  await bot.handle(say("u1", "โอนเงินให้แม่"));
  assert.match(lastText(sent), /ทำไม่ได้\nต้องล็อกอินธนาคาร/);
  assert.equal(actions(sent), undefined);
  assert.equal(store.job(1).status, "rejected");
  assert.equal(store.job(1).price, 0);
});

test("cancel before start, and nobody can start another user's job", async () => {
  const { store, bot, sent } = setup();
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u2", "start:1"));
  assert.match(lastText(sent), /เริ่มไปแล้ว หรือยกเลิกไปแล้ว/);
  assert.equal(store.job(1).status, "quoted");
  await bot.handle(tap("u1", "cancel:1"));
  assert.match(lastText(sent), /ยกเลิกแล้ว ไม่คิดเงิน/);
  await bot.handle(tap("u1", "start:1"));
  assert.equal(store.job(1).status, "cancelled");
  assert.equal(store.user("u1").credit, 20);
});

test("refunds: automatic 3 times a month, then review; only within 24 hours", async () => {
  const { store, bot, sent, later } = setup();
  store.grant("u1", 100);
  for (let i = 1; i <= 5; i++) {
    await bot.handle(say("u1", `งาน ${i}`));
    await bot.handle(tap("u1", `start:${i}`));
  }
  assert.equal(store.user("u1").credit, 120 - 45);
  for (let i = 1; i <= 3; i++) {
    await bot.handle(tap("u1", `refund:${i}`));
    assert.match(lastText(sent), /คืนเงิน ฿9 เป็นเครดิตแล้ว/);
  }
  assert.equal(store.user("u1").credit, 75 + 27);
  await bot.handle(tap("u1", "refund:4"));
  assert.match(lastText(sent), /ทีมงานจะตรวจให้ภายใน 1 วันทำการ/);
  assert.equal(store.job(4).status, "refund_review");
  await bot.handle(tap("u1", "refund:1"));
  assert.match(lastText(sent), /ขอคืนเงินไปแล้ว/);
  later(25);
  await bot.handle(tap("u1", "refund:5"));
  assert.match(lastText(sent), /เกินเวลาแล้ว/);
  assert.equal(store.user("u1").credit, 102);
  assert.equal(store.forceRefund(4), true, "staff approve the one under review");
  assert.equal(store.user("u1").credit, 111);
});

test("a failed job has nothing to refund", async () => {
  const { bot, sent } = setup({ runTask: async () => ({ ok: false, summary: "ไม่เจอ", sources: [] }) });
  await bot.handle(say("u1", "หาของ"));
  await bot.handle(tap("u1", "start:1"));
  await bot.handle(tap("u1", "refund:1"));
  assert.match(lastText(sent), /ไม่ได้คิดเงิน/);
});

test("after a restart, jobs left running are failed and paid back", async () => {
  const { store, bot, runner, sent } = setup();
  store.user("u1");
  store.addQuote("u1", "หาตั๋ว", QUOTE_M);
  assert.equal(store.start("u1", 1).ok, true);
  assert.equal(store.user("u1").credit, 11);
  await bot.notifyRestart(runner.recover());
  assert.equal(store.job(1).status, "failed");
  assert.equal(store.user("u1").credit, 20);
  assert.match(lastText(sent), /ระบบรีสตาร์ต/);
});

test("new users get a welcome with their starting credit, and can ask for their balance", async () => {
  const { bot, sent } = setup();
  await bot.handle({ type: "follow", replyToken: "r", source: { type: "user", userId: "u9" } });
  assert.match(lastText(sent), /บอกราคาก่อนเริ่มทุกงาน[\s\S]*฿20/);
  await bot.handle(say("u9", " เครดิต "));
  assert.match(lastText(sent), /^เครดิตคงเหลือ ฿20\n[\s\S]*\nu9$/);
});

test("a quote that throws gets an apology instead of silence", async () => {
  const { bot, sent } = setup({ quote: async () => { throw new Error("down"); } });
  await bot.handle(say("u1", "หาตั๋ว"));
  assert.match(lastText(sent), /ระบบขัดข้อง/);
});

test("group chats are ignored, so nobody pays for quotes there", async () => {
  let quotes = 0;
  const { bot, sent } = setup({ quote: async () => { quotes++; return QUOTE_M; } });
  await bot.handle(say("u1", "หาตั๋ว", "group"));
  assert.equal(quotes, 0);
  assert.equal(sent.length, 0);
});

test("stickers and photos get a hint instead of silence, and cost nothing", async () => {
  let quotes = 0;
  const { bot, sent } = setup({ quote: async () => { quotes++; return QUOTE_M; } });
  await bot.handle({ type: "message", replyToken: "r", source: { type: "user", userId: "u1" }, message: { type: "sticker", packageId: "1", stickerId: "1" } });
  assert.match(lastText(sent), /อ่านได้เฉพาะข้อความ/);
  assert.equal(quotes, 0);
});

test("the LINE result lists the options the agent found, each with its price, note and link", async () => {
  const options = [{ name: "Airline A 07:05", price: "฿1,290", note: "บินตรง", url: "https://a.example/flight" }, { name: "Airline B 09:30", price: "", note: "", url: "" }];
  const { bot, sent } = setup({ runTask: async () => ({ ...RESULT, options }) });
  await bot.handle(say("U1", "หาตั๋วไปเชียงใหม่"));
  await bot.handle(tap("U1", "start:1"));
  assert.match(lastText(sent), /ตัวเลือกที่เจอ\n1\. Airline A 07:05 · ฿1,290\nบินตรง\nhttps:\/\/a\.example\/flight\n2\. Airline B 09:30\n\nหลักฐาน/);
});

const PICTURED = [
  { name: "Airline A 07:05", price: "฿1,290", note: "บินตรง", url: "https://www.a.example/เที่ยวบิน", image: `/evidence/1-${"a".repeat(24)}.jpg`, logo: "/logo/a.example.png" },
  { name: "Airline B 09:30", price: "", note: "", url: "", image: `/evidence/1-${"b".repeat(24)}.webp` },
];
test("LINE gets the options as cards: product picture, name, price, the shop's logo and a button to the page", async () => {
  const { bot, sent } = setup({ runTask: async () => ({ ...RESULT, options: PICTURED }), publicUrl: "https://smith.example" });
  await bot.handle(say("U1", "หาตั๋วไปเชียงใหม่"));
  await bot.handle(tap("U1", "start:1"));
  const [cards, result] = sent.at(-1).messages;
  assert.equal(cards.type, "flex");
  const [a, b] = cards.contents.contents;
  assert.equal(a.hero.url, `https://smith.example/evidence/1-${"a".repeat(24)}.jpg`);
  assert.deepEqual(a.body.contents.slice(0, 3).map((c) => c.text), ["Airline A 07:05", "฿1,290", "บินตรง"]);
  assert.deepEqual(a.body.contents[3].contents.map((c) => c.url || c.text), ["https://smith.example/logo/a.example.png", "a.example"], "the shop's logo and name");
  assert.equal(a.footer.contents[0].action.uri, "https://www.a.example/%E0%B9%80%E0%B8%97%E0%B8%B5%E0%B9%88%E0%B8%A2%E0%B8%A7%E0%B8%9A%E0%B8%B4%E0%B8%99", "LINE wants the link percent-encoded");
  assert.equal(b.hero, undefined, "LINE cannot show WebP");
  assert.deepEqual(b.body.contents.map((c) => c.text), ["Airline B 09:30"], "no empty text boxes");
  assert.equal(b.footer, undefined, "no page, no button");
  assert.doesNotMatch(result.text, /ตัวเลือกที่เจอ/, "the cards replace the list in the text");
  assert.deepEqual(actions(sent), ["refund:1:price", "refund:1", "ask:1"], "the refund button stays on the last message");
});

test("if LINE refuses the cards, the result still arrives as text with the options listed", async () => {
  const { bot, sent } = setup({ runTask: async () => ({ ...RESULT, options: PICTURED }), publicUrl: "https://smith.example", refuse: (m) => m.some((x) => x.type === "flex") });
  await bot.handle(say("U1", "หาตั๋วไปเชียงใหม่"));
  await bot.handle(tap("U1", "start:1"));
  assert.deepEqual(sent.at(-1).messages.map((m) => m.type), ["text"]);
  assert.match(lastText(sent), /ตัวเลือกที่เจอ\n1\. Airline A 07:05 · ฿1,290/);
  assert.deepEqual(actions(sent), ["refund:1:price", "refund:1", "ask:1"]);
});

test("LINE card links are fully percent-encoded, and blank text is left out", async () => {
  const { optionCards } = await import("../src/line.js");
  const [card] = optionCards([{ name: "  ", price: " ", note: "", url: "https://a.example/s?q=a|b^c", image: "", logo: "" }], "https://smith.example").contents.contents;
  assert.equal(card.footer.contents[0].action.uri, "https://a.example/s?q=a%7Cb%5Ec");
  assert.deepEqual(card.body.contents.map((c) => c.text), ["ตัวเลือก", undefined]);
});

test("the LINE result lists discount codes with where they were seen, and what the agent could and could not read", async () => {
  const codes = [{ code: "SAVE10", shop: "ร้าน A", note: "ลด 10% ขั้นต่ำ ฿500", url: "https://a.example/promo" }];
  const coverage = { searches: 3, pages: 4, hosts: ["a.example", "b.example"], blocked: ["shopee.example"] };
  const { bot, sent } = setup({ runTask: async () => ({ ...RESULT, codes, coverage }) });
  await bot.handle(say("U1", "เทียบราคา"));
  await bot.handle(tap("U1", "start:1"));
  assert.match(lastText(sent), /โค้ดส่วนลดที่เจอ \(เจอบนหน้าเว็บ อาจหมดอายุ ตรวจก่อนใช้\)\n1\. SAVE10 · ร้าน A\nลด 10% ขั้นต่ำ ฿500\nhttps:\/\/a\.example\/promo/);
  assert.match(lastText(sent), /อ่านเว็บ: ค้น 3 ครั้ง · อ่าน 4 หน้า จาก 2 เว็บ\nอ่านไม่ได้: shopee\.example/);
  const { bot: plain, sent: plainSent } = setup();
  await plain.handle(say("U1", "เทียบราคา"));
  await plain.handle(tap("U1", "start:1"));
  assert.doesNotMatch(lastText(plainSent), /โค้ดส่วนลด|อ่านเว็บ:/, "nothing is said when there is nothing to say");
});

test("tapping 'wrong price' in LINE refunds in full, tags the job, and says it was Smith's mistake", async () => {
  const { store, bot, sent } = setup();
  await bot.handle(say("U1", "เทียบราคา"));
  await bot.handle(tap("U1", "start:1"));
  assert.equal(store.user("U1").credit, 11);
  await bot.handle(tap("U1", "refund:1:price"));
  assert.match(lastText(sent), /ราคาไม่ตรงเป็นความผิดของ Smith/);
  assert.equal(store.user("U1").credit, 20);
  assert.equal(store.job(1).refund_tag, "price");
  assert.equal(store.job(1).refund_reason, "ราคาไม่ตรงกับหน้าเว็บ");
});

test("when today's Claude budget is used up, a new quote and a start are turned down and nothing is charged", async () => {
  const { store, bot, sent } = setup({ dailyCostCap: 1 });
  await bot.handle(say("U1", "หาตั๋วไปเชียงใหม่"));
  assert.equal(store.jobsOf("U1").length, 1, "under the cap, quotes are made");
  store.addQuote("U1", "x", { doable: true, title: "t", steps: [], size: "M", cost: 5 }); // today's spending now passes the cap
  await bot.handle(say("U1", "อีกงาน"));
  assert.match(lastText(sent), /วันนี้ Smith รับงานเต็มแล้ว/);
  assert.equal(store.jobsOf("U1").length, 2, "no new quote was made");
  await bot.handle(tap("U1", "start:1"));
  assert.match(lastText(sent), /เครดิตของคุณไม่ถูกหัก/);
  assert.equal(store.job(1).status, "quoted");
  assert.equal(store.user("U1").credit, 20);
  await bot.handle(say("U1", "เครดิต"));
  assert.match(lastText(sent), /เครดิตคงเหลือ ฿20/, "asking for the balance still works");
});

test("'ผลล่าสุด' sends the newest finished result again as a reply, for someone whose pushed result never arrived", async () => {
  const codes = [{ code: "SAVE10", shop: "ร้าน A", note: "ลด 10%", url: "https://a.example/promo" }];
  const { bot, sent, later } = setup({ runTask: async () => ({ ...RESULT, codes }), refuse: () => true }); // every push fails, like a spent monthly quota
  await bot.handle(say("U1", "หาตั๋วไปเชียงใหม่"));
  await bot.handle(tap("U1", "start:1"));
  assert.ok(!sent.some((m) => m.to === "U1"), "nothing was pushed");
  later(5);
  await bot.handle(say("U1", "ผลล่าสุด"));
  const again = sent.at(-1);
  assert.equal(again.to, "reply", "a reply, which does not count against the monthly quota");
  assert.match(again.messages.at(-1).text, /เสร็จแล้ว: หาตั๋วไปเชียงใหม่[\s\S]*฿1,290[\s\S]*SAVE10/);
  assert.match(again.messages.at(-1).text, /เช็กเมื่อ 10:/, "it says when it was checked, not when it was asked for again");
  assert.deepEqual(actions(sent), ["refund:1:price", "refund:1", "ask:1"]);
});

test("'ผลล่าสุด' says so when the last job is still running, when there is nothing yet, and shows a failure as a failure", async () => {
  const { store, bot, sent } = setup({ runTask: async () => ({ ok: false, summary: "เว็บปิด", sources: [], usage: { cost: 1 } }) });
  await bot.handle(say("U1", "ผลล่าสุด"));
  assert.match(lastText(sent), /ยังไม่มีผลงานที่เสร็จ/);
  await bot.handle(say("U1", "หาตั๋ว"));
  await bot.handle(tap("U1", "start:1"));
  await bot.handle(say("U1", "ผลล่าสุด"));
  assert.match(lastText(sent), /ไม่สำเร็จ ไม่คิดเงิน: หาตั๋วไปเชียงใหม่\nเว็บปิด/);
  const second = store.addQuote("U1", "อีกงาน", { doable: true, title: "t", steps: [], size: "M", cost: 0 });
  store.start("U1", second.id);
  await bot.handle(say("U1", "ผลล่าสุด"));
  assert.match(lastText(sent), /งานล่าสุดยังทำอยู่/);
});

test("when the test round is full, a new LINE user gets no account and no paid quote; existing users carry on", async () => {
  let quoted = 0;
  const { store, bot, sent } = setup({ maxUsers: 1, quote: async () => (quoted++, QUOTE_M) });
  await bot.handle(say("U1", "หาตั๋ว"));
  assert.equal(quoted, 1);
  await bot.handle(say("U2", "หาตั๋ว"));
  assert.equal(quoted, 1, "no Claude call for someone outside the round");
  assert.equal(store.known("U2"), false);
  assert.match(lastText(sent), /รับผู้ทดลองครบแล้ว/);
  await bot.handle({ type: "follow", replyToken: "r", source: { type: "user", userId: "U3" } });
  assert.equal(store.known("U3"), false);
  await bot.handle(say("U1", "หาตั๋วอีก"));
  assert.equal(quoted, 2);
});

test("out of credit in LINE: the reply says where to pay; \"โอนแล้ว\" files one request for staff to check", async () => {
  const { store, bot, sent } = setup({ topup: { promptpay: "0812345678", name: "สมชาย", amount: 50 } });
  store.user("U1");
  store.grant("U1", -20); // spend the trial credit
  await bot.handle(say("U1", "หาตั๋ว"));
  const id = store.jobsOf("U1")[0].id;
  await bot.handle(tap("U1", `start:${id}`));
  assert.match(lastText(sent), /เครดิตไม่พอ[\s\S]*PromptPay 0812345678 \(สมชาย\)[\s\S]*หมายเหตุการโอนว่า SM[0-9A-F]{5}[\s\S]*พิมพ์ "โอนแล้ว"/);
  await bot.handle(say("U1", "โอนแล้ว"));
  await bot.handle(say("U1", "โอนแล้ว"));
  assert.match(lastText(sent), /รับแจ้งแล้ว/);
  assert.equal(store.pendingTopups().length, 1, "asking twice still makes one request");
  assert.equal(store.user("U1").credit, 0);
});

test("without a PromptPay number, \"โอนแล้ว\" is an ordinary task and the old top-up wording stays", async () => {
  let quoted = 0;
  const { store, bot, sent } = setup({ quote: async () => (quoted++, QUOTE_M) });
  await bot.handle(say("U1", "โอนแล้ว"));
  assert.equal(quoted, 1);
  assert.equal(store.pendingTopups().length, 0);
  await bot.handle(say("U1", "เครดิต"));
  assert.match(lastText(sent), /รหัสผู้ใช้/);
});

test("the founder hears in LINE about a new top-up (once per request), a refund sent to review, and the daily cap (once a day)", async () => {
  const told = [];
  const alerts = createAlerts({ push: async (to, m) => told.push([to, m[0].text]), adminId: "Uadmin" });
  const { store, bot, later } = setup({ topup: { promptpay: "0812345678", name: "", amount: 50 }, alerts, dailyCostCap: 1 });
  await bot.handle(say("U1", "โอนแล้ว"));
  await bot.handle(say("U1", "โอนแล้ว"));
  assert.equal(told.length, 1, "asking twice is one request, one alert");
  assert.match(told[0][1], /มีคำขอเติมเครดิต ฿50 \(คำขอที่ 1 · หมายเหตุ SM[0-9A-F]{5}\)[\s\S]*node src\/cli.js topup 1/);
  assert.equal(told[0][0], "Uadmin");
  store.addQuote("U1", "x", { doable: true, title: "t", steps: [], size: "M", cost: 2 }); // spend past the ฿1 cap
  await bot.handle(say("U1", "หาตั๋ว"));
  await bot.handle(say("U1", "หาตั๋วอีก"));
  assert.equal(told.filter(([, t]) => /ถึงเพดาน/.test(t)).length, 1, "the cap alert goes out once a day");
});

test("a refund that goes to review alerts the founder", async () => {
  const told = [];
  const alerts = createAlerts({ push: async (to, m) => told.push(m[0].text), adminId: "Uadmin" });
  const { store, bot } = setup({ alerts });
  store.grant("U1", 100);
  for (let i = 1; i <= 4; i++) {
    await bot.handle(say("U1", `งาน ${i}`));
    await bot.handle(tap("U1", `start:${i}`));
    await bot.handle(tap("U1", `refund:${i}`));
  }
  assert.equal(told.length, 1, "three refunds a month are automatic; the fourth goes to a person");
  assert.match(told[0], /คำขอคืนเงินรอตรวจ[\s\S]*node src\/cli.js queue/);
});

test("without ADMIN_LINE_ID, or when LINE refuses, alerts do nothing and never break the user's request", async () => {
  await createAlerts().send("x");
  const failing = createAlerts({ push: async () => { throw new Error("LINE 429"); }, adminId: "Uadmin", log: { error() {} } });
  await failing.send("x"); // resolves
});

test("a free re-search pushed to LINE carries no refund buttons", async () => {
  const { store, bot, runner, sent } = setup();
  const u = store.user("u1").id;
  const root = store.addQuote(u, "x", QUOTE_M);
  await runner.run(store.start(u, root.id).job);
  const free = store.addFollowUp(root.id, "x\n\nรอบนี้: y", { title: "y", steps: [], size: "M" });
  const done = await runner.run(store.start(u, free.id).job);
  await bot.notify(done.job, done.r);
  assert.match(lastText(sent), /เสร็จแล้ว/);
  assert.deepEqual(actions(sent), ["ask:2"], "it can be asked about, but has nothing to refund");
});

test("a result offers ถามต่อ; after tapping it the next message goes to that job's chat, not a new quote", async () => {
  const asked = [];
  const { store, bot, sent } = setup({ chat: async (job, text) => (asked.push([job.id, text]), CHAT_ANSWER()) });
  await bot.handle(say("u1", "หาตั๋วไปเชียงใหม่ศุกร์นี้"));
  await bot.handle(tap("u1", "start:1"));
  assert.ok(actions(sent).includes("ask:1"));
  await bot.handle(tap("u1", "ask:1"));
  assert.match(lastText(sent), /พิมพ์คำถาม[\s\S]*ถามได้อีก 10 ข้อ/);
  assert.deepEqual(actions(sent), ["new:0"]);
  await bot.handle(say("u1", "ร้านไหนส่งฟรี"));
  assert.deepEqual(asked, [[1, "ร้านไหนส่งฟรี"]]);
  assert.equal(lastText(sent), "ร้าน B ส่งฟรี ครับ", "markdown asterisks are stripped");
  assert.equal(sent.at(-1).to, "reply", "a reply, which LINE does not count against the push quota");
  assert.deepEqual(actions(sent), ["new:0"]);
  assert.equal(store.jobsOf("u1").length, 1, "no new job was quoted");
  await bot.handle(say("u1", "เครดิต"));
  assert.match(lastText(sent), /เครดิตคงเหลือ/, "commands still work in chat mode");
  await bot.handle(say("u1", "ผลล่าสุด"));
  assert.match(lastText(sent), /เสร็จแล้ว: หาตั๋วไปเชียงใหม่/);
  await bot.handle(say("u1", "แล้วร้านไหนถูกสุด"));
  assert.deepEqual(asked.at(-1), [1, "แล้วร้านไหนถูกสุด"], "and chat mode survives them");
});

test("a search reply offers ค้นใหม่ฟรี, which starts the free follow-up, and the next question is about its result", async () => {
  const asked = [];
  const SEARCH = { kind: "search", text: "จะค้นที่ถูกกว่า", title: "ตั๋ว**ถูกกว่า**", steps: ["ค้น 3 สายการบิน"], size: "M", cost: 0 };
  const { store, bot, sent } = setup({ chat: async (job, text) => (asked.push(job.id), asked.length === 1 ? SEARCH : CHAT_ANSWER()) });
  await bot.handle(say("u1", "หาตั๋วไปเชียงใหม่"));
  await bot.handle(tap("u1", "start:1"));
  await bot.handle(tap("u1", "ask:1"));
  await bot.handle(say("u1", "หาที่ถูกกว่านี้"));
  assert.match(lastText(sent), /จะค้นที่ถูกกว่า[\s\S]*ตั๋วถูกกว่า[\s\S]*1\. ค้น 3 สายการบิน/);
  assert.deepEqual(actions(sent), ["start:2", "new:0"]);
  assert.equal(sent.at(-1).messages.at(-1).quickReply.items[0].action.label, "ค้นใหม่ฟรี");
  const credit = store.user("u1").credit;
  await bot.handle(tap("u1", "start:2"));
  assert.equal(store.job(2).status, "done");
  assert.equal(store.user("u1").credit, credit, "free");
  assert.deepEqual(actions(sent), ["ask:2"]);
  await bot.handle(say("u1", "ร้านไหนส่งฟรี"));
  assert.deepEqual(asked, [1, 2], "a question typed after the new result is about the new job, not the old one");
});

test("งานใหม่ ends chat mode, and so do 10 quiet minutes", async () => {
  let asks = 0;
  const { store, bot, sent, later } = setup({ chat: async () => (asks++, CHAT_ANSWER()) });
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u1", "start:1"));
  await bot.handle(tap("u1", "ask:1"));
  await bot.handle(tap("u1", "new:0"));
  assert.match(lastText(sent), /งานใหม่/);
  await bot.handle(say("u1", "หาที่พักภูเก็ต"));
  assert.equal(asks, 0);
  assert.equal(store.jobsOf("u1").length, 2, "a new quote");
  await bot.handle(tap("u1", "ask:1"));
  later(9 / 60);
  await bot.handle(say("u1", "ถามอีกข้อ"));
  assert.equal(asks, 1, "9 minutes after the tap it is still chat");
  later(9 / 60);
  await bot.handle(say("u1", "อีกข้อ"));
  assert.equal(asks, 2, "the 10 minutes count from the last message, not from the tap");
  later(11 / 60);
  await bot.handle(say("u1", "หาร้านอาหาร"));
  assert.equal(asks, 2, "chat mode ended after 10 quiet minutes");
  assert.equal(store.jobsOf("u1").length, 3);
});

test("ถามต่อ is refused for another user's job, and u2's next message stays u2's own", async () => {
  let asks = 0;
  const { store, bot, sent } = setup({ chat: async () => (asks++, CHAT_ANSWER()) });
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u1", "start:1"));
  await bot.handle(tap("u2", "ask:1"));
  assert.match(lastText(sent), /ไม่พบงานนี้/);
  await bot.handle(say("u2", "หาที่พักภูเก็ต"));
  assert.equal(asks, 0);
  assert.equal(store.jobsOf("u2").length, 1, "u2's message is u2's own quote");
});

test("ถามต่อ is refused for a failed job", async () => {
  const { bot, sent } = setup({ runTask: async () => ({ ok: false, error: "x", summary: "ไม่เจอ", sources: [] }) });
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u1", "start:1"));
  await bot.handle(tap("u1", "ask:1"));
  assert.match(lastText(sent), /ถามต่อไม่ได้/);
});

test("ถามต่อ on a job with no questions left is refused at the tap", async () => {
  const { store, bot, sent } = setup();
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u1", "start:1"));
  store.addChat(1, Array.from({ length: 10 }, () => ({ role: "user", text: "q" })));
  await bot.handle(tap("u1", "ask:1"));
  assert.match(lastText(sent), /ถามครบ 10 ข้อแล้ว/);
  await bot.handle(say("u1", "หาที่พักภูเก็ต"));
  assert.equal(store.jobsOf("u1").length, 2, "the next message is a new job, not thrown away");
});

test("typing งานใหม่ in chat mode ends it without asking the model", async () => {
  let asks = 0;
  const { store, bot, sent } = setup({ chat: async () => (asks++, CHAT_ANSWER()) });
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u1", "start:1"));
  await bot.handle(tap("u1", "ask:1"));
  assert.match(lastText(sent), /งานใหม่/, "the prompt says how to get out");
  await bot.handle(say("u1", "งานใหม่"));
  assert.equal(asks, 0);
  await bot.handle(say("u1", "หาที่พักภูเก็ต"));
  assert.equal(asks, 0);
  assert.equal(store.jobsOf("u1").length, 2);
});

test("a second quick message is turned away with a clear note and a way out, and shares the app's one-at-a-time guard", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  let calls = 0;
  // A second call that reaches the model opens the gate, so a missing guard fails the test instead of hanging it.
  const { bot, chats, sent } = setup({ chat: async () => (++calls > 1 && release(), await gate, CHAT_ANSWER()) });
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u1", "start:1"));
  await bot.handle(tap("u1", "ask:1"));
  const fromApp = chats.ask(1, "ถามจากในแอป"); // the web app asking on the same job, through the same shared rules
  await bot.handle(say("u1", "ร้านไหนส่งฟรี"));
  assert.match(lastText(sent), /ส่งคำถามนี้อีกครั้งหลังได้คำตอบ/);
  assert.deepEqual(actions(sent), ["new:0"]);
  assert.equal(calls, 1);
  release();
  assert.ok((await fromApp).job);
});

test("when the model fails, the user hears so, with a way out", async () => {
  const { bot, sent } = setup({ chat: async () => { throw new Error("model timed out"); } });
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u1", "start:1"));
  await bot.handle(tap("u1", "ask:1"));
  await bot.handle(say("u1", "ร้านไหนส่งฟรี"));
  assert.match(lastText(sent), /ขอโทษครับ/);
  assert.deepEqual(actions(sent), ["new:0"]);
});

test("when the reply token ran out while Smith answered, the answer is pushed instead", async () => {
  const { bot, sent } = setup({ replyFails: (messages) => messages.at(-1).text?.startsWith("ร้าน B") });
  await bot.handle(say("u1", "หาตั๋ว"));
  await bot.handle(tap("u1", "start:1"));
  await bot.handle(tap("u1", "ask:1"));
  await bot.handle(say("u1", "ร้านไหนส่งฟรี"));
  assert.equal(sent.at(-1).to, "u1");
  assert.equal(lastText(sent), "ร้าน B ส่งฟรี ครับ");
});

// ---------- chat before a job
test("a question gets a free text answer in LINE, with no job card", async () => {
  const { store, bot, sent } = setup({ talk: async () => ({ kind: "answer", text: "ผมช่วยค้นและเทียบข้อมูลจากเว็บให้ **ครับ**", cost: 0.01 }) });
  await bot.handle(say("u1", "ทำไรได้บ้าง"));
  assert.equal(lastText(sent), "ผมช่วยค้นและเทียบข้อมูลจากเว็บให้ ครับ");
  assert.equal(actions(sent), undefined);
  assert.equal(store.jobsOf("u1").length, 0);
  assert.deepEqual(store.talkOf("u1").map((e) => e.role), ["user", "smith"]);
});

test("a job reply in LINE is today's quote card, for the full request", async () => {
  const { store, bot, sent } = setup({ talk: async () => ({ kind: "task", text: "หาให้ได้ครับ", task: "หาตั๋วไปเชียงใหม่ศุกร์นี้ ถูกสุด", ...QUOTE_M }) });
  await bot.handle(say("u1", "ถูกสุดนะ"));
  assert.match(lastText(sent), /งานนี้: หาตั๋วไปเชียงใหม่/);
  assert.match(lastText(sent), /คำขอ: หาตั๋วไปเชียงใหม่ศุกร์นี้ ถูกสุด/, "the card says what Smith will work on, since it differs from what was typed");
  assert.deepEqual(actions(sent), ["start:1", "cancel:1"]);
  assert.equal(store.job(1).text, "หาตั๋วไปเชียงใหม่ศุกร์นี้ ถูกสุด");
  await bot.handle(say("u2", "หาตั๋วไปเชียงใหม่ศุกร์นี้ ถูกสุด"));
  assert.doesNotMatch(lastText(sent), /คำขอ:/, "no request line when it is what the user typed");
});

test("LINE turns a refused message into a short line", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { bot, sent } = setup({ talk: async (past, t) => (t === "q1" && (await gate), { kind: "answer", text: "ok", cost: 0 }) });
  await bot.handle(say("u1", "ก".repeat(1001)));
  assert.match(lastText(sent), /ไม่เกิน 1,000 ตัวอักษร/);
  const first = bot.handle(say("u1", "q1"));
  await bot.handle(say("u1", "q2"));
  assert.match(lastText(sent), /กำลังตอบข้อความก่อนหน้า/);
  release();
  await first;
  assert.equal(lastText(sent), "ok");
});

test("when the reply token ran out while Smith quoted, the job card is pushed instead", async () => {
  const { bot, sent } = setup({ replyFails: (messages) => /งานนี้:/.test(messages.at(-1)?.text || "") });
  await bot.handle(say("u1", "หาตั๋วไปเชียงใหม่"));
  assert.equal(sent.at(-1).to, "u1");
  assert.match(lastText(sent), /งานนี้: หาตั๋วไปเชียงใหม่/);
  assert.deepEqual(actions(sent), ["start:1", "cancel:1"]);
});
