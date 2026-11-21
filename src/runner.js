import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

// One job from start to finish, shared by the LINE bot and the web app:
// run the agent, keep a screenshot as evidence when possible, then settle the credit.
export function createRunner({ store, runTask, screenshot, saveLogos = async () => {}, evidenceDir = "data/evidence", log = console }) {
  const live = new Map(); // job id -> steps so far, shown while it runs; gone once it finishes

  async function run(job) {
    const steps = [];
    live.set(job.id, steps);
    let r;
    try {
      r = await runTask(job, undefined, undefined, (step) => steps.length < 30 && steps.push({ at: new Date().toISOString(), text: step }));
    } catch (err) {
      log.error("run failed", job.id, err);
      r = { ok: false, error: String(err?.message || err), summary: "ระบบขัดข้องระหว่างทำงาน", sources: [] };
    }
    if (!r.ok) r.answer = r.summary || "Smith หาคำตอบที่เชื่อถือได้ไม่เจอ"; // what the user reads on a failed job
    if (r.ok) await saveLogos([...r.sources, ...(r.options || [])].map((x) => x.url), join(evidenceDir, "logos"));
    if (r.ok && r.bestUrl) {
      mkdirSync(evidenceDir, { recursive: true });
      // An unguessable name: the image is served without login (LINE fetches it), so the URL itself is the key.
      const name = `${job.id}-${randomBytes(12).toString("hex")}.png`;
      if (await screenshot(r.bestUrl, join(evidenceDir, name))) r.evidence = `/evidence/${name}`;
    }
    live.delete(job.id);
    return { job: store.finish(job.id, r), r };
  }

  // Jobs still "running" after a restart will never finish: give the credit back.
  function recover() {
    return store.running().map((job) => store.finish(job.id, { ok: false, error: "restart", answer: "ระบบรีสตาร์ตระหว่างทำงาน ลองสั่งใหม่ได้เลย" }));
  }

  return { run, recover, progress: (id) => live.get(id) || [] };
}
