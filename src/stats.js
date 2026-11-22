import { STORE_NET_RATE, SIZES, config } from "./config.js";

// The experiment's numbers: does Smith finish jobs, and does the price cover what Claude costs?
export function stats(db, now = new Date()) {
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
  // Which sites the agent could and could not read: tells whether the big shops are out of reach.
  const tally = (key) => {
    const n = new Map();
    for (const j of jobs) for (const h of (j.coverage ? JSON.parse(j.coverage)[key] : null) || []) n.set(h, (n.get(h) || 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).slice(0, 5);
  };
  const priceClaims = jobs.filter((j) => j.refund_tag === "price" && ["refunded", "refund_review"].includes(j.status)).length;
  // The weekly numbers in founder/marketing.md: did invitees start, run out of the trial credit, and pay to go on?
  const accounts = db.prepare("SELECT * FROM users").all();
  const firstStart = new Map();
  for (const j of started) if (!firstStart.has(j.user_id) || j.started_at < firstStart.get(j.user_id)) firstStart.set(j.user_id, j.started_at);
  const activated3d = accounts.filter((u) => firstStart.has(u.id) && Date.parse(firstStart.get(u.id)) - Date.parse(u.created_at) <= 3 * 86400e3).length;
  const toppedUp = db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM ledger WHERE kind = 'grant'").get().n;
  // Money actually received: PromptPay top-ups staff approved after seeing them in the bank. The number that answers "will anyone pay?"
  const paid = db.prepare("SELECT COUNT(DISTINCT user_id) AS n, COALESCE(SUM(amount), 0) AS baht FROM topups WHERE status = 'approved'").get();
  const topupsWaiting = db.prepare("SELECT COUNT(*) AS n FROM topups WHERE status = 'pending'").get().n;
  // Each finished job of a LINE user is one push message (cards, picture and text go out together), and the free
  // LINE OA plan stops delivering after its monthly quota. Counted from the 1st of this month, Thai time.
  const bkk = new Date(now.getTime() + 7 * 3600e3);
  const monthStart = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), 1) - 7 * 3600e3).toISOString();
  const linePushes = jobs.filter((j) => !j.user_id.startsWith("web:") && j.finished_at && j.finished_at >= monthStart).length
    + db.prepare("SELECT COUNT(*) AS n FROM topups WHERE user_id NOT LIKE 'web:%' AND decided_at >= ?").get(monthStart).n; // the CLI tells LINE users when it decides a top-up
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
    priceClaims,
    priceClaimRate: succeeded.length ? priceClaims / succeeded.length : 0,
    readHosts: tally("hosts"),
    blockedHosts: tally("blocked"),
    refundRate: succeeded.length ? (count("refunded") + count("refund_review")) / succeeded.length : 0,
    revenue,
    cost,
    margin: revenue - cost,
    marginAfterStoreFee: revenue * STORE_NET_RATE - cost,
    costPerStartedJob: started.length ? sum(started, (j) => j.quote_cost + j.run_cost) / started.length : 0,
    avgPricePaid: charged.length ? revenue / charged.length : 0,
    users: perUser.size,
    repeatUsers: [...perUser.values()].filter((n) => n >= 2).length,
    linePushes,
    accounts: accounts.length,
    activated3d,
    outOfCredit: accounts.filter((u) => u.credit < SIZES.S.price).length,
    toppedUp,
    paidUsers: paid.n,
    paidBaht: paid.baht,
    topupsWaiting,
    medianSeconds: seconds.length ? seconds[Math.floor(seconds.length / 2)] : 0,
  };
}

// One line per recent job, plus why it failed, was refunded or turned down: for reading the test by hand.
export function formatJobs(db, limit = 20) {
  const rows = db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT ?").all(limit);
  return rows.map((j) => {
    const secs = j.started_at && j.finished_at ? `${Math.round((Date.parse(j.finished_at) - Date.parse(j.started_at)) / 1000)} วินาที` : "-";
    const why = j.refund_reason ? `คืนเงิน: ${j.refund_reason}` : j.status === "failed" ? j.error || j.answer : j.status === "rejected" ? j.reason : "";
    return `#${j.id} ${j.status} · ราคา ฿${j.price} · ต้นทุน ฿${(j.quote_cost + j.run_cost).toFixed(2)} · ${secs} · ${j.title || j.text}${why ? `\n    ${why}` : ""}`;
  }).join("\n") || "ยังไม่มีงาน";
}

export function formatStats(s) {
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const thb = (x) => `฿${x.toFixed(2)}`;
  return [
    `ใบเสนอราคา ${s.quotes} · ทำไม่ได้ ${s.rejected} · ยกเลิก ${s.cancelled}`,
    `เริ่มงาน ${s.started} · กำลังทำ ${s.running} · สำเร็จ ${s.done} · ไม่สำเร็จ ${s.failed} · คืนเงิน ${s.refunded} · รอตรวจ ${s.refundReview}`,
    `อัตราสำเร็จ ${pct(s.successRate)} · อัตราขอคืนเงิน ${pct(s.refundRate)} · เวลากลาง ${s.medianSeconds.toFixed(0)} วินาที`,
    `ราคาไม่ตรงหน้าเว็บ ${s.priceClaims} งาน (${pct(s.priceClaimRate)} ของงานที่สำเร็จ)`,
    `เว็บที่อ่านได้บ่อย: ${s.readHosts.map(([h, n]) => `${h} ×${n}`).join(", ") || "-"}`,
    `เว็บที่อ่านไม่ได้: ${s.blockedHosts.map(([h, n]) => `${h} ×${n}`).join(", ") || "-"}`,
    `รายได้ ${thb(s.revenue)} · ต้นทุน Claude ${thb(s.cost)} · ต้นทุนต่องานที่เริ่ม ${thb(s.costPerStartedJob)} · ราคาเฉลี่ย ${thb(s.avgPricePaid)}`,
    `กำไรขั้นต้น ${thb(s.margin)} · หลังหัก VAT และค่าธรรมเนียมสโตร์ 15% ${thb(s.marginAfterStoreFee)}`,
    `ผู้ใช้ ${s.users} · กลับมาใช้ซ้ำ ${s.repeatUsers}`,
    `ข้อความ LINE แบบ push เดือนนี้ ${s.linePushes}${config.linePushQuota ? ` จากโควตา ${config.linePushQuota}${s.linePushes >= config.linePushQuota * 0.8 ? " ⚠ ใกล้เต็ม: เกินโควตาแล้วผลจะไม่ถึงผู้ใช้ ย้ายแพ็กเกจ LINE OA หรือบอกให้พิมพ์ \"ผลล่าสุด\"" : ""}` : ""}`,
    `บัญชี ${s.accounts} · เริ่มงานแรกภายใน 3 วัน ${s.activated3d} · เครดิตหมด ${s.outOfCredit} · ทีมงานเติมเครดิตให้ ${s.toppedUp} คน`,
    `จ่ายเงินจริง (PromptPay ที่อนุมัติแล้ว) ${s.paidUsers} คน รวม ฿${s.paidBaht}${s.topupsWaiting ? ` · รอตรวจ ${s.topupsWaiting} คำขอ (node src/cli.js topups)` : ""}`,
  ].join("\n");
}

// Refunds waiting for a person, wrong-price claims first (those are Smith's own mistakes): for `node src/cli.js queue`.
export function formatQueue(db) {
  const rows = db.prepare("SELECT * FROM jobs WHERE status = 'refund_review' ORDER BY (refund_tag = 'price') DESC, id").all();
  return rows.map((j) => {
    const top = JSON.parse(j.options || "[]")[0];
    return `#${j.id} ${j.refund_tag === "price" ? "[ราคาไม่ตรง] " : ""}${j.title || j.text}\n    ${j.refund_reason || "-"}${top?.url ? `\n    ${top.price || ""} ${top.url}` : ""}\n    อนุมัติ: node src/cli.js refund ${j.id}`;
  }).join("\n") || "ไม่มีคำขอรอตรวจ";
}
