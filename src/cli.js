// Admin commands for the experiment:
//   node src/cli.js doctor                    is this server set up for the test? (Claude, disk, LINE quota, settings)
//   node src/cli.js stats                     the experiment's numbers
//   node src/cli.js jobs [n]                  the last n jobs, with why each failed or was refunded
//   node src/cli.js grant <lineUserId> <baht> add credit for a tester
//   node src/cli.js backup                    copy the database now, next to it, and print where
//   node src/cli.js restore <file> yes        replace the database with a backup, then restart the server
//   node src/cli.js trial ["task" ...]       run real tasks once (8 built in, 12 at most): cost per job, success, sites it cannot read
//   node src/cli.js queue                     refunds waiting for review, wrong-price claims first
//   node src/cli.js refund <jobId>            approve a refund waiting for review
//   node src/cli.js topups                    PromptPay top-ups waiting: check each in your bank app first
//   node src/cli.js topup <id> [no]           credit a top-up you found in the bank (or "no": not received)
import { config, SIZES } from "./config.js";
import Anthropic from "@anthropic-ai/sdk";
import { checkSetup, formatSetup, liveProbes } from "./doctor.js";
import { openDb, makeStore, payRef } from "./db.js";
import { stats, formatStats, formatJobs, formatQueue } from "./stats.js";
import { backupDb, restoreDb } from "./backup.js";
import { quote, runTask } from "./agent.js";
import { TASKS, MAX_TASKS, runOne, formatRow, summarize, formatSummary } from "./trial.js";
import { lineClient, text, postback } from "./line.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const [cmd, a, b] = process.argv.slice(2);
const db = openDb(config.dbPath);
const store = makeStore(db, config);

if (cmd === "doctor") {
  const lineLogin = Boolean(config.lineLoginId && config.lineLoginSecret && config.publicUrl);
  console.log(formatSetup(await checkSetup(process.env, config, SIZES, liveProbes(config, { Anthropic, lineLogin }))));
} else if (cmd === "stats") {
  console.log(formatStats(stats(db)));
} else if (cmd === "jobs") {
  console.log(formatJobs(db, Number(a) || 20));
} else if (cmd === "grant" && a && Number.isInteger(Number(b))) {
  console.log(`credit of ${a}: ฿${store.grant(a, Number(b)).credit}`);
} else if (cmd === "backup") {
  console.log(await backupDb(db, join(dirname(config.dbPath), "backups")));
} else if (cmd === "restore" && a) {
  if (b !== "yes") {
    console.log(`This replaces the live database ${config.dbPath} with ${a}. Anything since that backup is lost.\nRun it again with the word yes at the end to go ahead, then restart the server.`);
    process.exitCode = 1;
  } else {
    await restoreDb(a, config.dbPath);
    console.log("restored. Restart the server now so it opens the restored database.");
  }
} else if (cmd === "trial") {
  const tasks = process.argv.slice(3).length ? process.argv.slice(3) : TASKS;
  if (tasks.length > MAX_TASKS) throw new Error(`at most ${MAX_TASKS} tasks: each one is a real, paid job`);
  mkdirSync(join(dirname(config.dbPath), "trials"), { recursive: true });
  const out = join(dirname(config.dbPath), "trials", `trial-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`);
  const say = (t) => (console.log(t), appendFileSync(out, `${t}\n`)); // saved as it goes, so a dropped shell loses nothing
  say(`${tasks.length} งานจริง รุ่น ${config.model} ใช้เครดิต ${config.openrouterKey ? "OpenRouter" : "Anthropic"} ของคุณ ผลบันทึกที่ ${out}`);
  const rows = [];
  for (const [i, text] of tasks.entries()) {
    rows.push(await runOne(text, { quote, runTask }));
    say(formatRow(rows[i], i));
  }
  say(`\n${formatSummary(summarize(rows))}`);
} else if (cmd === "queue") {
  console.log(formatQueue(db));
} else if (cmd === "refund" && Number(a)) {
  console.log(store.forceRefund(Number(a)) ? `refunded job ${a}` : `job ${a} is not refundable`);
} else if (cmd === "topups") {
  const rows = store.pendingTopups();
  console.log(rows.map((t) => `#${t.id} ฿${t.amount} · หมายเหตุ ${payRef(t.user_id)} · แจ้งเมื่อ ${new Date(t.created_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" })} · ${t.user_id}`).join("\n")
    || "ไม่มีคำขอเติมเครดิตที่รอตรวจ");
  if (rows.length) console.log(`\nเช็กในแอปธนาคารว่ามียอดที่หมายเหตุตรงกับคำขอ แล้วรัน: node src/cli.js topup <id>  (ไม่พบยอด: node src/cli.js topup <id> no)`);
} else if (cmd === "topup" && Number(a)) {
  const t = store.decideTopup(Number(a), b !== "no");
  if (!t) {
    console.log(`top-up ${a} is not waiting (already decided, or no such id)`);
    process.exitCode = 1;
  } else {
    console.log(t.status === "approved" ? `credited ฿${t.amount} to ${t.user_id}: balance ฿${t.credit}` : `turned down top-up ${a}`);
    // Tell a LINE user in their chat; offer to start the job that was waiting for credit. One push from the monthly quota.
    if (!t.user_id.startsWith("web:") && config.lineToken) {
      const waiting = store.jobsOf(t.user_id, 10).find((j) => j.status === "quoted" && j.price <= t.credit);
      const msg = t.status === "approved"
        ? text(`เติมเครดิต ฿${t.amount} แล้ว เครดิตคงเหลือ ฿${t.credit}${waiting ? `\nงานที่รอไว้: ${waiting.title}` : ""}`, waiting ? [postback(`เริ่มงาน ฿${waiting.price}`, `start:${waiting.id}`)] : [])
        : text(`ยังไม่พบยอดโอน ฿${t.amount} ในบัญชี ทีมงานจึงยังไม่เติมเครดิต ถ้าโอนแล้วจริง ทักมาในแชทนี้พร้อมสลิปได้เลยครับ`);
      await lineClient(config.lineToken).push(t.user_id, [msg]).then(() => console.log("told the user in LINE"), (err) => console.log(`LINE message failed: ${err.message}`));
    }
  }
} else {
  console.log("usage: node src/cli.js doctor | stats | jobs [n] | queue | trial [task ...] | backup | restore <file> yes | grant <userId> <baht> | refund <jobId> | topups | topup <id> [no]");
  process.exitCode = 1;
}
