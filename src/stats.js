import { STORE_NET_RATE } from "./config.js";

// The experiment's numbers: does Smith finish jobs, and does the price cover what Claude costs?
export function stats(db) {
  const jobs = db.prepare("SELECT * FROM jobs").all();
  const count = (status) => jobs.filter((j) => j.status === status).length;
  const sum = (list, f) => list.reduce((s, j) => s + f(j), 0);
  const started = jobs.filter((j) => j.started_at);
  const finished = started.filter((j) => j.finished_at && j.error !== "restart");
  const succeeded = finished.filter((j) => ["done", "refunded", "refund_review"].includes(j.status));
  const charged = jobs.filter((j) => ["done", "refund_review"].includes(j.status));
  const revenue = sum(charged, (j) => j.price);
  const cost = sum(jobs, (j) => j.quote_cost + j.run_cost);
  const perUser = new Map();
  for (const j of started) perUser.set(j.user_id, (perUser.get(j.user_id) || 0) + 1);
  const seconds = finished.map((j) => (Date.parse(j.finished_at) - Date.parse(j.started_at)) / 1000).sort((a, b) => a - b);
  return {
    quotes: jobs.length,
    rejected: count("rejected"),
    cancelled: count("cancelled"),
    started: started.length,
    running: count("running"),
    done: count("done"),
    failed: count("failed"),
    refunded: count("refunded"),
    refundReview: count("refund_review"),
    successRate: finished.length ? succeeded.length / finished.length : 0,
    refundRate: succeeded.length ? (count("refunded") + count("refund_review")) / succeeded.length : 0,
    revenue,
    cost,
    margin: revenue - cost,
    marginAfterStoreFee: revenue * STORE_NET_RATE - cost,
    costPerStartedJob: started.length ? sum(started, (j) => j.quote_cost + j.run_cost) / started.length : 0,
    avgPricePaid: charged.length ? revenue / charged.length : 0,
    users: perUser.size,
    repeatUsers: [...perUser.values()].filter((n) => n >= 2).length,
    medianSeconds: seconds.length ? seconds[Math.floor(seconds.length / 2)] : 0,
  };
}

export function formatStats(s) {
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const thb = (x) => `฿${x.toFixed(2)}`;
  return [
    `ใบเสนอราคา ${s.quotes} · ทำไม่ได้ ${s.rejected} · ยกเลิก ${s.cancelled}`,
    `เริ่มงาน ${s.started} · กำลังทำ ${s.running} · สำเร็จ ${s.done} · ไม่สำเร็จ ${s.failed} · คืนเงิน ${s.refunded} · รอตรวจ ${s.refundReview}`,
    `อัตราสำเร็จ ${pct(s.successRate)} · อัตราขอคืนเงิน ${pct(s.refundRate)} · เวลากลาง ${s.medianSeconds.toFixed(0)} วินาที`,
    `รายได้ ${thb(s.revenue)} · ต้นทุน Claude ${thb(s.cost)} · ต้นทุนต่องานที่เริ่ม ${thb(s.costPerStartedJob)} · ราคาเฉลี่ย ${thb(s.avgPricePaid)}`,
    `กำไรขั้นต้น ${thb(s.margin)} · หลังหัก VAT และค่าธรรมเนียมสโตร์ 15% ${thb(s.marginAfterStoreFee)}`,
    `ผู้ใช้ ${s.users} · กลับมาใช้ซ้ำ ${s.repeatUsers}`,
  ].join("\n");
}
