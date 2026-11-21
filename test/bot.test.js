import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, makeStore } from "../src/db.js";
import { createBot } from "../src/bot.js";
import { createRunner } from "../src/runner.js";

const QUOTE_M = { doable: true, reason: "", title: "หาตั๋วไปเชียงใหม่", steps: ["เปิดเว็บสายการบิน", "เทียบราคา"], size: "M", cost: 0.3 };
const RESULT = {
  ok: true, answer: "เที่ยวเช้า 07:05 ฿1,290", summary: "เจอแล้ว",
  sources: [{ title: "Airline A", url: "https://a.example/flight" }], bestUrl: "",
  usage: { cost: 4.2, input_tokens: 9000, output_tokens: 800, searches: 3 },
};

function setup({ quote = async () => QUOTE_M, runTask = async () => RESULT, clock, publicUrl, refuse = () => false } = {}) {
  let t = clock ?? Date.parse("2026-11-20T03:00:00Z");
  const store = makeStore(openDb(":memory:"), { startCredit: 20, now: () => new Date(t) });
  const sent = [];
  const line = {
    reply: async (token, messages) => sent.push({ to: "reply", messages }),
    push: async (to, messages) => {
      if (refuse(messages)) throw new Error("LINE push 400");
      sent.push({ to, messages });
    },
  };
  const runner = createRunner({ store, runTask, screenshot: async () => false, log: { error() {} } });
  const bot = createBot({ store, line, quote, runner, publicUrl, log: { error() {} } });
  return { store, bot, runner, sent, later: (hours) => (t += hours * 3600e3) };
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
  assert.deepEqual(actions(sent), ["refund:1:price", "refund:1"]);
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
  assert.deepEqual(actions(sent), ["refund:1:price", "refund:1"], "the refund button stays on the last message");
});

test("if LINE refuses the cards, the result still arrives as text with the options listed", async () => {
  const { bot, sent } = setup({ runTask: async () => ({ ...RESULT, options: PICTURED }), publicUrl: "https://smith.example", refuse: (m) => m.some((x) => x.type === "flex") });
  await bot.handle(say("U1", "หาตั๋วไปเชียงใหม่"));
  await bot.handle(tap("U1", "start:1"));
  assert.deepEqual(sent.at(-1).messages.map((m) => m.type), ["text"]);
  assert.match(lastText(sent), /ตัวเลือกที่เจอ\n1\. Airline A 07:05 · ฿1,290/);
  assert.deepEqual(actions(sent), ["refund:1:price", "refund:1"]);
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
