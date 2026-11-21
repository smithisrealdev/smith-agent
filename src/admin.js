import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { backupDb } from "./backup.js";

// One staff-only route, GET /admin/backup, which downloads a fresh copy of the database so it can be kept off the
// server. It answers 404 unless ADMIN_TOKEN is set, wants the token in an Authorization header (never in the URL,
// which ends up in logs and browser history), and locks itself for 10 minutes after 10 wrong tokens.
export function createAdmin({ db, token, backupDir, log = console, now = () => Date.now() }) {
  const digest = (s) => createHash("sha256").update(String(s)).digest();
  const want = token ? digest(token) : null;
  let wrong = []; // times of recent wrong tokens
  let sending = false; // one download at a time: two would share the same file

  return async function admin(req, res) {
    if (!req.url.startsWith("/admin/")) return false;
    const reply = (status, headers = {}) => (res.writeHead(status, headers), res.end(), true);
    if (!want || req.method !== "GET" || req.url !== "/admin/backup") return reply(404);

    wrong = wrong.filter((t) => now() - t < 600e3);
    if (wrong.length >= 10) return reply(429);
    const given = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1] ?? "";
    if (!timingSafeEqual(digest(given), want)) {
      wrong.push(now());
      return reply(401);
    }

    if (sending) return reply(503, { "Retry-After": "5" });
    sending = true;
    // Its own folder with one file, so downloads never push the daily copies out.
    const dir = join(backupDir, "download");
    let file;
    try {
      file = await backupDb(db, dir, { keep: 1, now: new Date(now()) });
    } catch (err) {
      sending = false;
      throw err;
    }
    const name = `smith-${new Date(now()).toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}.db`;
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" });
    log.log("admin backup downloaded");
    const stream = createReadStream(file);
    stream.pipe(res);
    stream.on("close", () => {
      sending = false;
      rm(file, { force: true }); // the copy exists only for this download
    });
    return true;
  };
}
