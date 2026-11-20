import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { SIZES } from "./config.js";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const APP_FILES = new Set(["index.html", "app.js", "app.css", "manifest.webmanifest", "icon.svg"]);

// What the app sees of a job: never the raw row, so costs, tokens and internal errors stay on the server.
export function jobView(j) {
  return {
    id: j.id,
    text: j.text,
    title: j.title,
    steps: JSON.parse(j.steps || "[]"),
    price: j.price,
    minutes: SIZES[j.size]?.minutes ?? 3,
    status: j.status,
    reason: j.reason || "",
    answer: j.answer || "",
    sources: JSON.parse(j.sources || "[]"),
    evidence: j.evidence || "",
    createdAt: j.created_at,
    startedAt: j.started_at,
    finishedAt: j.finished_at,
  };
}

// The phone app's API. A device keeps a random token; the server only stores its hash as the user id.
export function createWeb({ store, quote, runner, publicDir = "public", evidenceDir = "data/evidence", inviteCode = "", quotesPerHour = 30, now = () => new Date(), log = console }) {
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
    return true;
  };
  const userOf = (req) => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || "");
    return m ? `web:${createHash("sha256").update(m[1]).digest("hex").slice(0, 32)}` : null;
  };
  const body = async (req) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 10_000) throw Object.assign(new Error("body too large"), { status: 413 });
      chunks.push(chunk);
    }
    try {
      return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    } catch {
      throw Object.assign(new Error("bad json"), { status: 400 });
    }
  };
  const credit = (userId) => store.user(userId).credit;
  const ownJob = (userId, id) => {
    const j = store.job(id);
    return j && j.user_id === userId ? j : null;
  };
  const sendFile = async (res, file, type) => {
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return true;
  };

  async function api(req, res, path, userId) {
    const m = /^\/api\/jobs\/(\d+)(?:\/(start|cancel|refund))?$/.exec(path);
    const id = m && Number(m[1]);

    if (req.method === "GET" && path === "/api/me") return json(res, 200, { id: userId, credit: credit(userId) });

    if (req.method === "DELETE" && path === "/api/me") {
      for (const file of store.deleteUser(userId)) await rm(join(evidenceDir, basename(file)), { force: true });
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && path === "/api/jobs") return json(res, 200, { jobs: store.jobsOf(userId).map(jobView) });

    if (req.method === "GET" && path === "/api/ledger") return json(res, 200, { credit: credit(userId), entries: store.ledgerOf(userId) });

    if (req.method === "POST" && path === "/api/quote") {
      const text = String((await body(req)).text || "").trim();
      if (!text || text.length > 1000) return json(res, 400, { error: "text" });
      store.user(userId);
      const hourAgo = new Date(now() - 3600e3).toISOString();
      if (store.quotesSince(userId, hourAgo) >= quotesPerHour) return json(res, 429, { error: "rate" });
      const job = store.addQuote(userId, text, await quote(text));
      return json(res, 200, { job: jobView(job), credit: credit(userId) });
    }

    if (m && !m[2] && req.method === "GET") {
      const j = ownJob(userId, id);
      return j ? json(res, 200, { job: jobView(j), credit: credit(userId) }) : json(res, 404, { error: "not_found" });
    }

    if (m && m[2] && req.method === "POST") {
      if (!ownJob(userId, id)) return json(res, 404, { error: "not_found" });
      if (m[2] === "start") {
        const r = store.start(userId, id);
        if (!r.ok) return json(res, 409, { error: r.reason, credit: credit(userId) });
        runner.run(r.job).catch((err) => log.error("job failed", id, err)); // the app polls the job for the result
        return json(res, 200, { job: jobView(r.job), credit: credit(userId) });
      }
      if (m[2] === "cancel") return json(res, 200, { ok: store.cancel(userId, id) });
      const { reasons = [], note = "" } = await body(req);
      const why = [...(Array.isArray(reasons) ? reasons : []), note].map((s) => String(s).trim()).filter(Boolean).join(" · ").slice(0, 500);
      const r = store.refund(userId, id, why);
      return json(res, 200, { result: r.result, job: r.job ? jobView(store.job(id)) : null, credit: credit(userId) });
    }

    return json(res, 404, { error: "not_found" });
  }

  // Returns true when it answered the request.
  return async function handle(req, res) {
    const path = new URL(req.url, "http://local").pathname;

    if (req.method === "GET" && !path.startsWith("/api/")) {
      const evidence = /^\/evidence\/(\d+-[0-9a-f]{24}\.png)$/.exec(path);
      if (evidence) return sendFile(res, join(evidenceDir, evidence[1]), TYPES[".png"]);
      const name = path === "/" ? "index.html" : path.slice(1);
      return APP_FILES.has(name) ? sendFile(res, join(publicDir, name), TYPES[extname(name)]) : false;
    }
    if (!path.startsWith("/api/")) return false;

    // While testing with people outside the team, an invite code keeps strangers from spending your Claude credit.
    if (inviteCode && req.headers["x-invite"] !== inviteCode) return json(res, 403, { error: "invite" });
    const userId = userOf(req);
    if (!userId) return json(res, 401, { error: "auth" });
    try {
      return await api(req, res, path, userId);
    } catch (err) {
      if (err.status) return json(res, err.status, { error: err.message });
      log.error("api failed", path, err);
      return json(res, 500, { error: "server" });
    }
  };
}
