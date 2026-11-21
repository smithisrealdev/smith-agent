import { SIZES, STORE_NET_RATE } from "./config.js";

// Real tasks to run once on the live server, to find out what a job really costs, how often it succeeds, and which
// sites Smith cannot read (three of them name Shopee and Lazada, the sites buyers use most).
export const TASKS = [
  "เทียบราคาหูฟัง Sony WH-1000XM6 จาก 3 ร้าน พร้อมลิงก์",
  "เทียบราคาโน้ตบุ๊ก ASUS Vivobook 15 จาก Lazada Shopee และร้านทางการ พร้อมลิงก์",
  "เทียบราคาตู้เย็น 2 ประตู ความจุประมาณ 7 คิว จาก Lazada กับร้านอื่น พร้อมโค้ดส่วนลดถ้ามี",
  "เทียบราคาแอร์ 12000 BTU จาก Shopee Lazada และร้านเครื่องใช้ไฟฟ้า",
  "หาตั๋วเครื่องบินไปเชียงใหม่ศุกร์หน้า กลับอาทิตย์ ถูกสุด",
  "หาที่พักเชียงใหม่ 2 คืน งบไม่เกิน 3,000 บาทต่อคืน รีวิวดี",
  "สรุปข่าวสำคัญวันนี้เรื่องเศรษฐกิจไทย 5 ข้อ พร้อมแหล่งข่าว",
  "หาร้านอาหารญี่ปุ่นย่านทองหล่อ งบไม่เกิน 800 บาทต่อคน รีวิวดี",
];
export const MAX_TASKS = 12; // each task is a real, paid job

// The founder's own pass marks: 80% of jobs succeed and 10% of those are refunded, so 72% of started jobs are paid.
const PAID_SHARE = 0.8 * 0.9;

// The cheapest medium-job price whose revenue, after the store's cut, carries the cost of an average started job.
export function suggestPrice(avgCost, candidates = [9, 12, 15, 20]) {
  return candidates.find((p) => avgCost <= PAID_SHARE * p * STORE_NET_RATE) ?? null;
}

// One task from quote to result. Nothing is written to the database: a trial must not mix into the real test's numbers.
export async function runOne(text, { quote, runTask }) {
  const started = Date.now();
  const row = { text, cost: 0, seconds: 0, ok: false, size: "", note: "", searches: 0, pages: 0, hosts: [], blocked: [], codes: 0, options: 0 };
  try {
    const q = await quote(text);
    row.cost = q.cost || 0;
    if (!q.doable) {
      row.note = `ทำไม่ได้: ${q.reason}`;
      return row;
    }
    row.size = q.size;
    const r = await runTask({ text, steps: JSON.stringify(q.steps), size: q.size });
    Object.assign(row, {
      ok: r.ok, note: r.ok ? (r.answer || "").replace(/\s+/g, " ").slice(0, 90) : r.error || r.summary || "ไม่สำเร็จ",
      cost: row.cost + (r.usage?.cost || 0), searches: r.coverage?.searches || 0, pages: r.coverage?.pages || 0,
      hosts: r.coverage?.hosts || [], blocked: r.coverage?.blocked || [], codes: r.codes?.length || 0, options: r.options?.length || 0,
    });
  } catch (err) {
    row.note = `ระบบขัดข้อง: ${String(err?.message || err).slice(0, 120)}`;
  } finally {
    row.seconds = Math.round((Date.now() - started) / 1000);
  }
  return row;
}

export const formatRow = (r, i) =>
  `${i + 1}. ${r.ok ? "สำเร็จ" : "ไม่สำเร็จ"} · ${r.size || "-"} · ต้นทุน ฿${r.cost.toFixed(2)} · ${r.seconds} วินาที · ค้น ${r.searches} อ่าน ${r.pages} หน้า` +
  `${r.blocked.length ? ` · อ่านไม่ได้: ${r.blocked.join(", ")}` : ""}${r.codes ? ` · โค้ด ${r.codes}` : ""}\n   ${r.text}\n   ${r.note}`;

// The numbers the founder needs: cost per job, success rate, sites out of reach, and the price they point to.
export function summarize(rows) {
  const n = rows.length;
  const total = rows.reduce((s, r) => s + r.cost, 0);
  const ran = rows.filter((r) => r.size); // jobs that got as far as running: a task turned down at the quote is not a started job
  const avg = ran.length ? ran.reduce((s, r) => s + r.cost, 0) / ran.length : 0;
  const medium = rows.filter((r) => r.size === "M");
  const avgM = medium.length >= 3 ? medium.reduce((s, r) => s + r.cost, 0) / medium.length : null; // fewer than 3 is not an average
  const count = (key) => {
    const c = new Map();
    for (const r of rows) for (const h of r[key]) c.set(h, (c.get(h) || 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]).slice(0, 6);
  };
  const basis = avgM ?? avg;
  return { n, ran: ran.length, ok: rows.filter((r) => r.ok).length, total, avg, avgM, blocked: count("blocked"), read: count("hosts"), codes: rows.reduce((s, r) => s + r.codes, 0), price: ran.length ? suggestPrice(basis) : null, basis };
}

export function formatSummary(s) {
  const lines = [
    `งาน ${s.n} · สำเร็จ ${s.ok} (${s.n ? Math.round((100 * s.ok) / s.n) : 0}%, เกณฑ์ของคุณ 80%) · ต้นทุนรวม ฿${s.total.toFixed(2)}`,
    `ต้นทุนเฉลี่ยต่องานที่เริ่ม ฿${s.avg.toFixed(2)}${s.avgM === null ? " (งานกลางน้อยกว่า 3 งาน จึงใช้ค่าเฉลี่ยทุกงานตัดสินราคา)" : ` · เฉพาะงานกลาง ฿${s.avgM.toFixed(2)}`}`,
    `เว็บที่อ่านได้: ${s.read.map(([h, c]) => `${h} ×${c}`).join(", ") || "-"}`,
    `เว็บที่อ่านไม่ได้: ${s.blocked.map(([h, c]) => `${h} ×${c}`).join(", ") || "-"}`,
    `โค้ดส่วนลดที่เจอรวม ${s.codes} โค้ด`,
    !s.ran
      ? "ยังบอกราคาไม่ได้: ไม่มีงานไหนทำถึงขั้นรัน ดูข้อความผิดพลาดด้านบน (เช่น ยังไม่ได้ตั้ง ANTHROPIC_API_KEY)"
      : s.price === null
      ? `ราคางานกลาง: ต้นทุน ฿${s.basis.toFixed(2)} สูงเกินกว่าที่ราคา ฿${SIZES.M.price}–20 แบกได้ (ตามเกณฑ์สำเร็จ 80% คืนเงิน 10%) ต้องลดต้นทุนก่อน เช่น ใช้โมเดลที่ถูกกว่า`
      : `ราคางานกลางที่ควรใช้ตามกฎใน founder/pricing.md: ฿${s.price} (ตอนนี้ ฿${SIZES.M.price})`,
    "ข้อควรระวัง: ตัวอย่างเล็ก ใช้เป็นแนวทาง ไม่ใช่ค่าเฉลี่ยของผู้ใช้จริง และยังไม่รวมค่าเซิร์ฟเวอร์",
  ];
  return lines.join("\n");
}
