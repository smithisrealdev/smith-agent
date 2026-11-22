// Pure helpers shared by the screens, ported from public/app.js so the app reads the same as the web app.
// No React Native imports here: test/format.test.ts runs this file with plain Node.

export const baht = (n: number | null | undefined) => `฿${Number(n || 0).toLocaleString("th-TH")}`;

export const hostOf = (url?: string | null) => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const clock = (d: Date) => d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

export function when(iso?: string | null, now = Date.now()) {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = (now - d.getTime()) / 60000;
  if (mins < 1) return "เมื่อกี้";
  if (mins < 60) return `${Math.floor(mins)} นาทีที่แล้ว`;
  if (new Date(now).toDateString() === d.toDateString()) return `วันนี้ ${clock(d)}`;
  return `${d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })} ${clock(d)}`;
}

export function duration(from?: string | null, to: string = new Date().toISOString()) {
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(String(from))) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return `${s} วินาที`;
  return `${Math.floor(s / 60)} นาที${s % 60 ? ` ${s % 60} วินาที` : ""}`;
}

export type Tone = "" | "good" | "bad" | "warn" | "grey";
export const STATUS: Record<string, [string, Tone]> = {
  quoted: ["รอเริ่ม", "grey"],
  running: ["กำลังทำ", ""],
  done: ["เสร็จแล้ว", "good"],
  failed: ["ไม่สำเร็จ ไม่คิดเงิน", "bad"],
  refunded: ["คืนเงินแล้ว", "warn"],
  refund_review: ["รอตรวจคืนเงิน", "warn"],
  cancelled: ["ยกเลิกแล้ว", "grey"],
  rejected: ["Smith ทำไม่ได้", "grey"],
};

// What kind of job it is, from its words; first match wins (a cheap flight is a flight, not a price check).
const KINDS: [string, RegExp][] = [
  ["plane", /ตั๋ว|เที่ยวบิน|เครื่องบิน|สายการบิน|บินไป|ที่พัก|โรงแรม|ทริป|เที่ยว|flight|hotel/i],
  ["receipt", /ราคาส่ง|ขายส่ง|เข้าร้าน|สต็อก/i],
  ["food", /ร้านอาหาร|อาหาร|ร้านอร่อย|คาเฟ่|กาแฟ|ของกิน|บุฟเฟ่ต์|ร้านกิน|ร้าน.{0,8}(กิน|อร่อย)/i],
  ["doc", /ข่าว|สรุป|บทความ|อ่าน|รีวิว/i],
  ["tag", /ราคา|เทียบ|ซื้อ|ถูก|โค้ด|ส่วนลด|โปร|shopee|lazada/i],
];
export const kindOf = (text?: string | null) => KINDS.find(([, re]) => re.test(text || ""))?.[0] || "sparkle";

// The model sometimes marks bold with **; the app shows plain text.
export const plain = (s?: string | null) => String(s ?? "").replace(/\*\*(.+?)\*\*/gs, "$1");

// Smith's answer as paragraphs and lists: "-", "•" or ✅ lines become a check list, numbered lines a numbered list.
const LIST_LINE = /^\s*(?:[-•*]|✅|✔️?|\d+[.)])\s+/u;
export type Run = { kind: "p" | "ul" | "ol"; lines: string[]; lead?: boolean };
export function answerRuns(answer?: string | null): Run[] {
  const runs: Run[] = [];
  for (const block of plain(answer).trim().split(/\n\s*\n/)) {
    let run = null as Run | null;
    for (const line of block.split("\n").filter((l) => l.trim())) {
      const kind = !LIST_LINE.test(line) ? "p" : /^\s*\d+[.)]\s/.test(line) ? "ol" : "ul";
      if (run?.kind !== kind) runs.push((run = { kind, lines: [] }));
      run.lines.push(kind === "p" ? line : line.replace(LIST_LINE, ""));
    }
  }
  if (runs[0]?.kind === "p" && runs[0].lines.join("\n").length <= 90) runs[0].lead = true; // only a short opening reads as a headline
  return runs;
}

export const isWeb = (u?: string | null) => /^https?:\/\//.test(String(u || ""));

// The result as plain text for a friend or a LINE group: names, prices and shop links, and when it was checked.
export function shareText(j: { title: string; answer: string; options?: { name: string; price?: string; url?: string }[]; codes?: { code: string }[]; finishedAt: string | null }) {
  const at = j.finishedAt ? new Date(j.finishedAt) : new Date();
  return [
    `Smith เช็กให้: ${j.title}`,
    ...(j.options?.length
      ? j.options.map((o, i) => [`${i + 1}. ${o.name}${o.price ? ` · ${o.price}` : ""}`, isWeb(o.url) ? o.url : ""].filter(Boolean).join("\n"))
      : [String(j.answer || "").slice(0, 400)]),
    ...(j.codes?.length ? [`โค้ดที่เจอบนหน้าเว็บ (อาจหมดอายุ): ${j.codes.map((c) => c.code).join(", ")}`] : []),
    `เช็กเมื่อ ${at.toLocaleDateString("th-TH", { day: "numeric", month: "short" })} ${clock(at)} ราคาอาจเปลี่ยน ตรวจที่ลิงก์ก่อนซื้อ`,
  ].join("\n");
}

// A brand domain an option carries, else its page's host: whose logo to show.
export const brandOf = (o?: { brand?: string; url?: string } | null) => (/^[a-z0-9.-]+$/.test(o?.brand || "") ? (o!.brand as string) : hostOf(o?.url));

export const thisMonth = (iso: string, now = new Date()) => {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

// Why a message, a quote or a start was turned down, by HTTP status.
export const NO: Record<number, string> = { 429: "ส่งบ่อยเกินไป รอสักครู่แล้วลองใหม่", 503: "วันนี้ Smith รับงานเต็มแล้ว ลองใหม่พรุ่งนี้ ไม่คิดเงิน" };
