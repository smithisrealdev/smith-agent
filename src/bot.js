import { SIZES, REFUND } from "./config.js";
import { text, postback, image, optionCards } from "./line.js";
import { payRef } from "./db.js";
import { createAlerts, ALERT } from "./alerts.js";

const baht = (n) => `฿${n}`;
const clock = (at) => new Date(at ?? Date.now()).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
// What the agent opened, in one or two lines. Nothing for jobs from before this was recorded.
const coverageText = (c) => {
  if (!c || (!c.searches && !c.pages)) return "";
  const lines = [`อ่านเว็บ: ค้น ${c.searches} ครั้ง · อ่าน ${c.pages} หน้า จาก ${c.hosts.length} เว็บ`];
  if (c.blocked?.length) lines.push(`อ่านไม่ได้: ${c.blocked.join(", ")} (ราคาจากเว็บนี้อาจไม่อยู่ในผล)`);
  return lines.join("\n");
};

const welcome = (credit) =>
  [
    "สวัสดีครับ ผม Smith พิมพ์งานที่อยากให้ทำบนเว็บได้เลย เช่น",
    "• หาตั๋วเครื่องบินไปเชียงใหม่ศุกร์นี้ ถูกสุด",
    "• เทียบราคาหูฟัง Sony WH-1000XM6 3 ร้าน",
    "",
    "เช็กให้ ตรวจได้ ผิดคืนเงิน: Smith บอกราคาก่อนเริ่มทุกงาน ไม่สำเร็จไม่คิดเงิน ราคาไม่ตรงหน้าเว็บขอคืนได้ใน 24 ชั่วโมง",
    `เครดิตเริ่มต้นของคุณ ${baht(credit)} · พิมพ์ "เครดิต" เพื่อดูยอด`,
  ].join("\n");

const FULL = "วันนี้ Smith รับงานเต็มแล้วครับ ลองใหม่พรุ่งนี้ ไม่คิดเงิน และเครดิตของคุณไม่ถูกหัก";
const CLOSED = "ขอบคุณที่สนใจครับ รอบทดลองของ Smith รับผู้ทดลองครบแล้ว ทีมงานจะแจ้งเมื่อเปิดรอบถัดไป";

// A finished job as the runner reported it, rebuilt from what was stored: for sending it again.
const resultOf = (j) => ({
  ok: j.status !== "failed", answer: j.answer, evidence: j.evidence,
  sources: JSON.parse(j.sources || "[]"), options: JSON.parse(j.options || "[]"), codes: JSON.parse(j.codes || "[]"),
  coverage: j.coverage ? JSON.parse(j.coverage) : null,
});

export function createBot({ store, line, quote, runner, publicUrl = "", dailyCostCap = 0, maxUsers = 0, topup = null, alerts = createAlerts(), log = console }) {
  // How to pay, in one message: where to transfer, then the word that tells staff to check.
  const howToPay = (userId) => topup
    ? `เติมเครดิต ${baht(topup.amount)}: โอนไปที่ PromptPay ${topup.promptpay}${topup.name ? ` (${topup.name})` : ""} ใส่หมายเหตุการโอนว่า ${payRef(userId)} แล้วพิมพ์ "โอนแล้ว" ทีมงานตรวจยอดแล้วเติมให้ภายใน 1 วันทำการ`
    : `ช่วงทดลอง ทักทีมงานเพื่อเติมเครดิต พิมพ์ "เครดิต" เพื่อดูรหัสผู้ใช้`;
  const full = () => {
    const over = dailyCostCap > 0 && store.spentToday() >= dailyCostCap; // today's Claude budget is used up
    if (over) alerts.once("cap", ALERT.cap(dailyCostCap));
    return over;
  };
  async function onText(userId, replyToken, msg) {
    const user = store.user(userId);
    if (msg.trim() === "เครดิต") {
      // Testers send this id to staff, who add credit with `node src/cli.js grant <id> <baht>`.
      return line.reply(replyToken, [text(topup ? `เครดิตคงเหลือ ${baht(user.credit)}\n${howToPay(userId)}\nรหัสผู้ใช้ ${userId}` : `เครดิตคงเหลือ ${baht(user.credit)}\nรหัสผู้ใช้ (ส่งให้ทีมงานเมื่อขอเติมเครดิต)\n${userId}`)]);
    }
    if (msg.trim() === "ผลล่าสุด") return line.reply(replyToken, await latest(userId));
    if (msg.trim() === "โอนแล้ว" && topup) {
      const t = store.requestTopup(userId, topup.amount);
      if (t.fresh) alerts.send(ALERT.topup(t, payRef(userId)));
      return line.reply(replyToken, [text(`รับแจ้งแล้ว (คำขอที่ ${t.id} · หมายเหตุการโอน ${payRef(userId)}) ทีมงานจะตรวจยอด ${baht(t.amount)} ในบัญชีแล้วเติมเครดิตให้ภายใน 1 วันทำการ เติมแล้วจะแจ้งในแชทนี้\nถ้ายังไม่ได้โอน คำขอจะถูกปฏิเสธ`)]);
    }
    if (full()) return line.reply(replyToken, [text(FULL)]); // every quote is a paid Claude call
    const job = store.addQuote(userId, msg, await quote(msg));
    if (job.status === "rejected") return line.reply(replyToken, [text(`ขอโทษครับ งานนี้ Smith ยังทำไม่ได้\n${job.reason}\nไม่คิดเงินครับ`)]);
    const steps = JSON.parse(job.steps).map((s, i) => `${i + 1}. ${s}`);
    const quoteText = [
      `งานนี้: ${job.title}`, "Smith จะ", ...steps, "",
      `ราคา ${baht(job.price)} · ประมาณ ${SIZES[job.size].minutes} นาที`,
      "✓ จ่ายไม่เกินนี้  ✓ ไม่สำเร็จ ไม่คิดเงิน",
      `เครดิตคงเหลือ ${baht(user.credit)}`,
    ].join("\n");
    return line.reply(replyToken, [text(quoteText, [postback(`เริ่มงาน ${baht(job.price)}`, `start:${job.id}`), postback("ยกเลิก", `cancel:${job.id}`)])]);
  }

  async function onPostback(userId, replyToken, data) {
    const [action, raw, kind] = data.split(":");
    const id = Number(raw);
    if (action === "start") {
      if (full()) return line.reply(replyToken, [text(FULL)]); // not started, so nothing is charged
      const r = store.start(userId, id);
      if (!r.ok) {
        const msg = r.reason === "credit"
          ? `เครดิตไม่พอ งานนี้ ${baht(r.job.price)} คุณมี ${baht(store.user(userId).credit)}\n${howToPay(userId)}\nเติมแล้วกดเริ่มงานนี้ได้อีกครั้ง`
          : "งานนี้เริ่มไปแล้ว หรือยกเลิกไปแล้วครับ";
        return line.reply(replyToken, [text(msg)]);
      }
      await line.reply(replyToken, [text(`เริ่มแล้ว: ${r.job.title}\nเสร็จแล้วจะส่งผลมาในแชทนี้ ปิดแชทได้เลย ถ้าไม่เห็นผล พิมพ์ "ผลล่าสุด"`)]);
      return work(r.job);
    }
    if (action === "cancel") {
      return line.reply(replyToken, [text(store.cancel(userId, id) ? "ยกเลิกแล้ว ไม่คิดเงินครับ" : "งานนี้เริ่มไปแล้ว ยกเลิกไม่ได้ครับ")]);
    }
    if (action === "refund") {
      const price = kind === "price";
      const r = store.refund(userId, id, price ? REFUND.priceReason : "", { price });
      if (r.result === "review") alerts.send(ALERT.review(r.job, price ? REFUND.priceReason : "ผลไม่ตรง (จาก LINE)"));
      const msg = {
        refunded: `คืนเงิน ${baht(r.job?.price)} เป็นเครดิตแล้ว${price ? " ราคาไม่ตรงเป็นความผิดของ Smith ขอโทษด้วยครับ" : ""}\nเครดิตคงเหลือ ${baht(store.user(userId).credit)}\nขอบคุณที่บอก เราจะเอาไปปรับ Smith`,
        review: `เดือนนี้ใช้สิทธิ์คืนเงิน${price ? "กรณีราคาไม่ตรง" : ""}อัตโนมัติครบ ${price ? REFUND.priceAutoPerMonth : REFUND.autoPerMonth} ครั้งแล้ว ทีมงานจะตรวจให้ภายใน 1 วันทำการ`,
        expired: "ขอคืนเงินได้ภายใน 24 ชั่วโมงหลังได้ผลงาน งานนี้เกินเวลาแล้วครับ",
        already: "งานนี้ขอคืนเงินไปแล้วครับ",
        not_charged: "งานนี้ไม่ได้คิดเงินครับ",
        not_found: "ไม่พบงานนี้ครับ",
      }[r.result];
      return line.reply(replyToken, [text(msg)]);
    }
  }

  // Run the agent and report back by push: the reply token has expired by the time the work is done.
  async function work(job) {
    const { job: done, r } = await runner.run(job);
    return notify(done, r);
  }

  // The result as LINE messages: `cards` is the richer version (option cards), `plain` is text only for when LINE turns the cards down.
  function resultMessages(job, r) {
    const credit = baht(store.user(job.user_id).credit);
    if (!r.ok) {
      const failed = [text(`ไม่สำเร็จ ไม่คิดเงิน: ${job.title}\n${r.answer}\nเครดิตเท่าเดิม ${credit}`)];
      return { cards: failed, plain: failed };
    }
    const sources = r.sources.map((s, i) => `${i + 1}. ${s.title}\n${s.url}`);
    const options = (r.options || []).map((o, i) => [`${i + 1}. ${o.name}${o.price ? ` · ${o.price}` : ""}`, o.note, o.url].filter(Boolean).join("\n"));
    const codes = (r.codes || []).map((c, i) => [`${i + 1}. ${c.code}${c.shop ? ` · ${c.shop}` : ""}`, c.note, c.url].filter(Boolean).join("\n"));
    const reach = coverageText(r.coverage);
    const when = `เช็กเมื่อ ${clock(job.finished_at)} · จ่าย ${baht(job.price)} · เครดิตเหลือ ${credit}`;
    // The quick reply shows only on the last message, so the result text goes last and pictures first.
    const result = (list) => text(
      [
        `เสร็จแล้ว: ${job.title}`, "", r.answer, "",
        ...(list && options.length ? ["ตัวเลือกที่เจอ", ...options, ""] : []),
        ...(codes.length ? ["โค้ดส่วนลดที่เจอ (เจอบนหน้าเว็บ อาจหมดอายุ ตรวจก่อนใช้)", ...codes, ""] : []),
        "หลักฐาน", ...sources, ...(reach ? ["", reach] : []), "", when,
      ].join("\n"),
      [postback("ราคาไม่ตรงหน้าเว็บ", `refund:${job.id}:price`), postback("ผลไม่ตรงอย่างอื่น", `refund:${job.id}`)],
    );
    const shot = r.evidence && publicUrl ? [image(publicUrl + r.evidence)] : []; // LINE needs an absolute https URL
    const plain = [...shot, result(true)];
    // The options go out as cards, with product pictures and shop logos where there are any.
    return { cards: !publicUrl || !options.length ? plain : [...shot, optionCards(r.options, publicUrl), result(false)], plain };
  }

  // The result message in LINE, pushed when the work is done. Web-only accounts have no chat to send it to.
  async function notify(job, r) {
    if (!job || job.user_id.startsWith("web:")) return; // no job: the account was deleted while it ran
    const { cards, plain } = resultMessages(job, r);
    if (cards === plain) return line.push(job.user_id, plain);
    return line.push(job.user_id, cards).catch((err) => {
      log.error("option cards refused", err);
      return line.push(job.user_id, plain);
    });
  }

  // "ผลล่าสุด": the newest finished result again. It goes out as a reply, which LINE does not count against the
  // monthly message quota, so it still works for someone whose pushed result never arrived.
  async function latest(userId) {
    const jobs = store.jobsOf(userId, 20);
    if (jobs[0]?.status === "running") return [text('งานล่าสุดยังทำอยู่ครับ เสร็จแล้วจะส่งผลมาในแชทนี้ ถ้านานกว่าเวลาที่แจ้งไว้ พิมพ์ "ผลล่าสุด" อีกครั้ง')];
    const job = jobs.find((j) => ["done", "refunded", "refund_review", "failed"].includes(j.status));
    if (!job) return [text("ยังไม่มีผลงานที่เสร็จครับ พิมพ์งานที่อยากให้ทำมาได้เลย")];
    return resultMessages(job, resultOf(job)).cards;
  }

  async function handle(e) {
    // 1:1 chats only: in a group every message would trigger a paid quote.
    const userId = e.source?.type === "user" ? e.source.userId : null;
    if (!userId) return;
    try {
      if (maxUsers > 0 && !store.known(userId) && store.userCount() >= maxUsers) {
        return e.replyToken && await line.reply(e.replyToken, [text(CLOSED)]); // the test round is full: no account, no paid quote
      }
      if (e.type === "message" && e.message?.type === "text") return await onText(userId, e.replyToken, e.message.text);
      if (e.type === "message") return await line.reply(e.replyToken, [text("ตอนนี้ Smith อ่านได้เฉพาะข้อความ พิมพ์งานที่อยากให้ทำมาได้เลยครับ")]);
      if (e.type === "postback") return await onPostback(userId, e.replyToken, e.postback?.data || "");
      if (e.type === "follow") return await line.reply(e.replyToken, [text(welcome(store.user(userId).credit))]);
    } catch (err) {
      log.error("event failed", err);
      if (e.replyToken) await line.reply(e.replyToken, [text("ขอโทษครับ ระบบขัดข้อง ลองส่งใหม่อีกครั้ง")]).catch(() => {});
    }
  }

  // Tell LINE users whose job was cut short by a restart (the runner has already paid them back).
  async function notifyRestart(jobs) {
    for (const job of jobs.filter((j) => !j.user_id.startsWith("web:"))) {
      await line.push(job.user_id, [text(`ไม่สำเร็จ ไม่คิดเงิน: ${job.title}\nระบบรีสตาร์ตระหว่างทำงาน ลองสั่งใหม่ได้เลย`)]).catch((err) => log.error("restart notice failed", err));
    }
  }

  return { handle, work, notify, notifyRestart };
}
