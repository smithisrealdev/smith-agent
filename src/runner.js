import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";
import { logoHost } from "./logo.js";

const PHONE = { width: 412, height: 600 }; // live pictures are shown on a phone, so the page is opened at phone width
const TAKEN_OVER = "คุณขอทำต่อเอง Smith หยุดงานแล้ว ไม่คิดเงินงานนี้";
// The page a user who takes over opens: the one in the live picture, as the app's address bar names it (pictures lag
// behind the pages read), else the page being opened.
const shown = (w) => w.frame?.url || w.page;

// One job from start to finish, shared by the LINE bot and the web app:
// run the agent, keep a screenshot as evidence when possible, then settle the credit.
export function createRunner({ store, runTask, screenshot, saveLogos = async () => [], saveImages = async () => {}, evidenceDir = "data/evidence", log = console }) {
  const logos = join(evidenceDir, "logos");
  // job id -> what the app shows while it runs: the steps so far, the page the agent opened last, and the latest
  // picture of a page it read; gone once it finishes.
  const live = new Map();
  // An unguessable name: the image is served without login (LINE fetches it), so the URL itself is the key.
  const shotName = (id) => `${id}-${randomBytes(12).toString("hex")}.png`;
  const remove = (image) => rm(join(evidenceDir, basename(image)), { force: true }).catch(() => {});

  // Pictures of the pages the agent reads, so testers watch it work. Taken beside the job, which never waits for them,
  // one at a time: a page opened meanwhile waits as `next`, and only the newest waits. Each picture replaces the last.
  function watcher(id, w) {
    const take = async (url) => {
      w.shooting = true;
      try {
        mkdirSync(evidenceDir, { recursive: true });
        const name = shotName(id);
        const ok = await screenshot(url, join(evidenceDir, name), PHONE);
        if (ok && w.over) remove(name); // the job ended while this was taken
        else if (ok) {
          if (w.frame) remove(w.frame.image);
          w.frame = { url, image: `/evidence/${name}` };
        }
      } catch (err) {
        log.error("live picture failed", id, err);
      }
      w.shooting = false;
      const next = w.next;
      w.next = "";
      if (next && !w.over) take(next);
    };
    return (url) => (w.shooting ? (w.next = url) : take(url));
  }

  async function run(job) {
    const w = { steps: [], page: "", frame: null, next: "", shooting: false, over: false, takenOver: false, abort: new AbortController() };
    w.ended = new Promise((resolve) => (w.end = resolve));
    live.set(job.id, w);
    const watch = watcher(job.id, w);
    let r;
    try {
      r = await runTask(job, undefined, undefined, (step, url = "") => {
        if (w.steps.length >= 30) return;
        w.steps.push({ at: new Date().toISOString(), text: step, host: logoHost(url) });
        if (!url) return;
        Promise.resolve(saveLogos([url], logos)).catch(() => {}); // fetched now, so the step can show the site's logo while the job runs
        w.page = url;
        watch(url);
      }, w.abort.signal);
    } catch (err) {
      // shortcut: a stopped job records no cost, since OpenRouter states the charge only at the end of the stream; count it from the OpenRouter dashboard if take-overs get common
      if (w.takenOver) r = { ok: false, error: "taken_over", summary: TAKEN_OVER, sources: shown(w) ? [{ title: logoHost(shown(w)), url: shown(w) }] : [] };
      else {
        log.error("run failed", job.id, err);
        r = { ok: false, error: String(err?.message || err), summary: "ระบบขัดข้องระหว่างทำงาน", sources: [] };
      }
    }
    if (!r.ok) r.answer = r.summary || "Smith หาคำตอบที่เชื่อถือได้ไม่เจอ"; // what the user reads on a failed job
    if (r.ok) {
      r.options ||= [];
      for (const o of r.options) o.brand ||= logoHost(o.url);
      const sites = [...r.sources.map((s) => s.url), ...r.options.map((o) => o.url), ...r.options.map((o) => o.brand && `https://${o.brand}/`)].filter(Boolean);
      const [have] = await Promise.all([saveLogos(sites, logos), saveImages(r.options, evidenceDir, job.id)]);
      for (const o of r.options) if (have?.includes(o.brand)) o.logo = `/logo/${o.brand}.png`; // LINE must know the file exists
    }
    if (r.ok && r.bestUrl) {
      mkdirSync(evidenceDir, { recursive: true });
      const name = shotName(job.id);
      if (await screenshot(r.bestUrl, join(evidenceDir, name))) r.evidence = `/evidence/${name}`;
    }
    w.over = true;
    live.delete(job.id);
    if (w.frame) await remove(w.frame.image); // live pictures are only for watching; the evidence above is the one kept
    let done;
    try {
      done = store.finish(job.id, r);
    } finally {
      w.end();
    }
    // The account was deleted while this ran: its files were written after the delete, so remove them now.
    if (!done) for (const f of [r.evidence, ...(r.options || []).map((o) => o.image)].filter(Boolean)) await remove(f);
    return { job: done, r };
  }

  // "ให้ฉันทำต่อเอง": stop the agent now; the job ends cancelled and its hold goes back. Waits until the job is settled,
  // so the app reads it finished. Returns the page the agent was on, or null when the job is not running here.
  async function stop(id) {
    const w = live.get(id);
    if (!w) return null;
    w.takenOver = true;
    w.abort.abort();
    await w.ended;
    return shown(w);
  }

  // Jobs still "running" after a restart will never finish: give the credit back.
  function recover() {
    return store.running().map((job) => store.finish(job.id, { ok: false, error: "restart", answer: "ระบบรีสตาร์ตระหว่างทำงาน ลองสั่งใหม่ได้เลย" }));
  }

  const watching = (id) => {
    const w = live.get(id);
    return w ? { page: w.page, frame: w.frame } : null;
  };
  return { run, recover, stop, watching, progress: (id) => live.get(id)?.steps || [] };
}
