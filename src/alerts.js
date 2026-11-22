// LINE messages to the founder when something needs a person: money to check, a refund to review, the day's Claude
// budget used up. Off unless ADMIN_LINE_ID is set. Each one is a push from the same monthly LINE quota as results.
import { text } from "./line.js";

const thaiDay = (d) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);

export function createAlerts({ push = null, adminId = "", log = console, now = () => new Date() } = {}) {
  const sent = new Set();
  const send = (message) => (push && adminId
    ? push(adminId, [text(message)]).catch((err) => log.error("alert to the founder failed", err.message)) // never breaks the user's request
    : Promise.resolve());
  return {
    send,
    // At most once per Thai day for the same kind of alert (the daily cost cap is checked on every request).
    once(kind, message) {
      const key = `${kind}:${thaiDay(now())}`;
      if (sent.has(key)) return Promise.resolve();
      sent.add(key);
      return send(message);
    },
  };
}

// What the founder reads, with the command to act on it.
export const ALERT = {
  topup: (t, ref) => `มีคำขอเติมเครดิต ฿${t.amount} (คำขอที่ ${t.id} · หมายเหตุ ${ref})\nเช็กยอดในแอปธนาคาร แล้วรัน: node src/cli.js topup ${t.id}`,
  review: (j, why) => `คำขอคืนเงินรอตรวจ: งาน #${j.id} ${j.title || ""} · ฿${j.price}\nเหตุผล: ${why || "-"}\nดูคิว: node src/cli.js queue`,
  cap: (baht) => `ค่า Claude วันนี้ถึงเพดาน ฿${baht} แล้ว Smith หยุดรับงานใหม่จนเที่ยงคืน (ตั้งที่ DAILY_COST_CAP)`,
};
