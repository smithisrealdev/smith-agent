import { SIZES } from "./config.js";
import { text, postback, image, optionCards, lineCanShow } from "./line.js";

const baht = (n) => `฿${n}`;
const clock = () => new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });

const welcome = (credit) =>
  [
    "สวัสดีครับ ผม Smith พิมพ์งานที่อยากให้ทำบนเว็บได้เลย เช่น",
    "• หาตั๋วเครื่องบินไปเชียงใหม่ศุกร์นี้ ถูกสุด",
    "• เทียบราคาหูฟัง Sony WH-1000XM6 3 ร้าน",
    "",
    "Smith บอกราคาก่อนเริ่มทุกงาน ไม่สำเร็จไม่คิดเงิน",
    `เครดิตเริ่มต้นของคุณ ${baht(credit)} · พิมพ์ "เครดิต" เพื่อดูยอด`,
  ].join("\n");

export function createBot({ store, line, quote, runner, publicUrl = "", log = console }) {
  async function onText(userId, replyToken, msg) {
    const user = store.user(userId);
    if (msg.trim() === "เครดิต") {
      // Testers send this id to staff, who add credit with `node src/cli.js grant <id> <baht>`.
      return line.reply(replyToken, [text(`เครดิตคงเหลือ ${baht(user.credit)}\nรหัสผู้ใช้ (ส่งให้ทีมงานเมื่อขอเติมเครดิต)\n${userId}`)]);
    }
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
    const [action, raw] = data.split(":");
    const id = Number(raw);
    if (action === "start") {
      const r = store.start(userId, id);
      if (!r.ok) {
        const msg = r.reason === "credit"
          ? `เครดิตไม่พอ งานนี้ ${baht(r.job.price)} คุณมี ${baht(store.user(userId).credit)}\nช่วงทดลอง ทักทีมงานเพื่อเติมเครดิต พิมพ์ "เครดิต" เพื่อดูรหัสผู้ใช้`
          : "งานนี้เริ่มไปแล้ว หรือยกเลิกไปแล้วครับ";
        return line.reply(replyToken, [text(msg)]);
      }
      await line.reply(replyToken, [text(`เริ่มแล้ว: ${r.job.title}\nเสร็จแล้วจะส่งผลมาในแชทนี้ ปิดแชทได้เลย`)]);
      return work(r.job);
    }
    if (action === "cancel") {
      return line.reply(replyToken, [text(store.cancel(userId, id) ? "ยกเลิกแล้ว ไม่คิดเงินครับ" : "งานนี้เริ่มไปแล้ว ยกเลิกไม่ได้ครับ")]);
    }
    if (action === "refund") {
      const r = store.refund(userId, id);
      const msg = {
        refunded: `คืนเงิน ${baht(r.job?.price)} เป็นเครดิตแล้ว\nเครดิตคงเหลือ ${baht(store.user(userId).credit)}\nขอบคุณที่บอก เราจะเอาไปปรับ Smith`,
        review: "เดือนนี้ใช้สิทธิ์คืนเงินอัตโนมัติครบ 3 ครั้งแล้ว ทีมงานจะตรวจให้ภายใน 1 วันทำการ",
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

  // The result message in LINE. Web-only accounts have no chat to send it to.
  async function notify(job, r) {
    if (!job || job.user_id.startsWith("web:")) return; // no job: the account was deleted while it ran
    const credit = baht(store.user(job.user_id).credit);
    if (!r.ok) {
      return line.push(job.user_id, [text(`ไม่สำเร็จ ไม่คิดเงิน: ${job.title}\n${r.answer}\nเครดิตเท่าเดิม ${credit}`)]);
    }
    const sources = r.sources.map((s, i) => `${i + 1}. ${s.title}\n${s.url}`);
    const options = (r.options || []).map((o, i) => [`${i + 1}. ${o.name}${o.price ? ` · ${o.price}` : ""}`, o.note, o.url].filter(Boolean).join("\n"));
    const when = `เช็กเมื่อ ${clock()} · จ่าย ${baht(job.price)} · เครดิตเหลือ ${credit}`;
    // The quick reply shows only on the last message, so the result text goes last and pictures first.
    const result = (list) => text(
      [`เสร็จแล้ว: ${job.title}`, "", r.answer, "", ...(list && options.length ? ["ตัวเลือกที่เจอ", ...options, ""] : []), "หลักฐาน", ...sources, "", when].join("\n"),
      [postback("ผลไม่ตรง ขอเงินคืน", `refund:${job.id}`)],
    );
    const shot = r.evidence && publicUrl ? [image(publicUrl + r.evidence)] : []; // LINE needs an absolute https URL
    if (!publicUrl || !(r.options || []).some((o) => lineCanShow(o.image))) return line.push(job.user_id, [...shot, result(true)]);
    // With product pictures the options go out as cards. If LINE turns the cards down, the result still arrives as text.
    return line.push(job.user_id, [...shot, optionCards(r.options, publicUrl), result(false)]).catch((err) => {
      log.error("option cards refused", err);
      return line.push(job.user_id, [...shot, result(true)]);
    });
  }

  async function handle(e) {
    // 1:1 chats only: in a group every message would trigger a paid quote.
    const userId = e.source?.type === "user" ? e.source.userId : null;
    if (!userId) return;
    try {
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
