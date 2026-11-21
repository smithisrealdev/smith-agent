import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { logoHost } from "./logo.js";

// One job from start to finish, shared by the LINE bot and the web app:
// run the agent, keep a screenshot as evidence when possible, then settle the credit.
export function createRunner({ store, runTask, screenshot, saveLogos = async () => [], saveImages = async () => {}, evidenceDir = "data/evidence", log = console }) {
  const logos = join(evidenceDir, "logos");
  const live = new Map(); // job id -> steps so far, shown while it runs; gone once it finishes

  async function run(job) {
    const steps = [];
    live.set(job.id, steps);
    let r;
    try {
      r = await runTask(job, undefined, undefined, (step, url = "") => {
        if (steps.length >= 30) return;
        steps.push({ at: new Date().toISOString(), text: step, host: logoHost(url) });
        if (url) Promise.resolve(saveLogos([url], logos)).catch(() => {}); // fetched now, so the step can show the site's logo while the job runs
      });
    } catch (err) {
      log.error("run failed", job.id, err);
      r = { ok: false, error: String(err?.message || err), summary: "ระบบขัดข้องระหว่างทำงาน", sources: [] };
    }
    if (!r.ok) r.answer = r.summary || "Smith หาคำตอบที่เชื่อถือได้ไม่เจอ"; // what the user reads on a failed job
    if (r.ok) {
      r.options ||= [];
      const [have] = await Promise.all([saveLogos([...r.sources, ...r.options].map((x) => x.url), logos), saveImages(r.options, evidenceDir, job.id)]);
      for (const o of r.options) if (have?.includes(logoHost(o.url))) o.logo = `/logo/${logoHost(o.url)}.png`; // LINE must know the file exists
    }
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
