import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SIZES, REFUND } from "./config.js";

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, credit INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL, -- quoted | rejected | cancelled | running | done | failed | refunded | refund_review
      title TEXT, steps TEXT, size TEXT, reason TEXT,
      price INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      quote_cost REAL NOT NULL DEFAULT 0, run_cost REAL NOT NULL DEFAULT 0, -- THB actually spent on Claude
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, searches INTEGER NOT NULL DEFAULT 0,
      answer TEXT, sources TEXT, evidence TEXT, error TEXT,
      refund_reason TEXT -- what the user said was wrong, to improve the agent
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, job_id INTEGER,
      amount INTEGER NOT NULL, -- credit in baht, + adds to the user's balance
      kind TEXT NOT NULL,      -- start | grant | hold | release | refund
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

// Credit and job rules. Every balance change writes a ledger row in the same transaction.
export function makeStore(db, { startCredit, now = () => new Date() }) {
  const iso = () => now().toISOString();
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };
  const move = (userId, amount, kind, jobId = null) => {
    run("UPDATE users SET credit = credit + ? WHERE id = ?", amount, userId);
    run("INSERT INTO ledger (user_id, job_id, amount, kind, created_at) VALUES (?, ?, ?, ?, ?)", userId, jobId, amount, kind, iso());
  };
  const job = (id) => one("SELECT * FROM jobs WHERE id = ?", id);

  return {
    job,
    user(id) {
      if (!one("SELECT id FROM users WHERE id = ?", id)) {
        tx(() => {
          run("INSERT INTO users (id, credit, created_at) VALUES (?, 0, ?)", id, iso());
          move(id, startCredit, "start");
        });
      }
      return one("SELECT * FROM users WHERE id = ?", id);
    },

    addQuote(userId, text, q) {
      const size = SIZES[q.size] ? q.size : "M";
      const { lastInsertRowid } = run(
        `INSERT INTO jobs (user_id, text, status, title, steps, size, reason, price, quote_cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId, text, q.doable ? "quoted" : "rejected", q.title || "", JSON.stringify(q.steps || []), size,
        q.reason || "", q.doable ? SIZES[size].price : 0, q.cost || 0, iso(),
      );
      return job(Number(lastInsertRowid));
    },

    // Hold the price before work starts. A second tap on "start" finds the job already running.
    start(userId, jobId) {
      return tx(() => {
        const j = one("SELECT * FROM jobs WHERE id = ? AND user_id = ?", jobId, userId);
        if (!j) return { ok: false, reason: "not_found" };
        if (j.status !== "quoted") return { ok: false, reason: "not_quoted", job: j };
        if (run("UPDATE users SET credit = credit - ? WHERE id = ? AND credit >= ?", j.price, userId, j.price).changes !== 1) {
          return { ok: false, reason: "credit", job: j };
        }
        run("INSERT INTO ledger (user_id, job_id, amount, kind, created_at) VALUES (?, ?, ?, 'hold', ?)", userId, jobId, -j.price, iso());
        run("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?", iso(), jobId);
        return { ok: true, job: job(jobId) };
      });
    },

    cancel(userId, jobId) {
      return run("UPDATE jobs SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'quoted'", jobId, userId).changes === 1;
    },

    // Success keeps the hold as the charge; failure gives it back ("no charge when it fails").
    finish(jobId, r) {
      return tx(() => {
        const j = job(jobId);
        if (!j || j.status !== "running") return j;
        const u = r.usage || {};
        run(
          `UPDATE jobs SET status = ?, finished_at = ?, run_cost = ?, input_tokens = ?, output_tokens = ?, searches = ?,
             answer = ?, sources = ?, evidence = ?, error = ? WHERE id = ?`,
          r.ok ? "done" : "failed", iso(), u.cost || 0, u.input_tokens || 0, u.output_tokens || 0, u.searches || 0,
          r.answer || "", JSON.stringify(r.sources || []), r.evidence || "", r.error || "", jobId,
        );
        if (!r.ok) move(j.user_id, j.price, "release", jobId);
        return job(jobId);
      });
    },

    // "Wrong result" refund: automatic within the window up to the monthly cap, otherwise queued for a person.
    refund(userId, jobId, reason = "") {
      return tx(() => {
        const j = one("SELECT * FROM jobs WHERE id = ? AND user_id = ?", jobId, userId);
        if (!j) return { result: "not_found" };
        if (["refunded", "refund_review"].includes(j.status)) return { result: "already", job: j };
        if (j.status !== "done") return { result: "not_charged", job: j };
        if (now() - Date.parse(j.finished_at) > REFUND.windowHours * 3600e3) return { result: "expired", job: j };
        const month = iso().slice(0, 7);
        const used = one("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND kind = 'refund' AND created_at >= ?", userId, month).n;
        if (used >= REFUND.autoPerMonth) {
          run("UPDATE jobs SET status = 'refund_review', refund_reason = ? WHERE id = ?", reason, jobId);
          return { result: "review", job: job(jobId) };
        }
        run("UPDATE jobs SET status = 'refunded', refund_reason = ? WHERE id = ?", reason, jobId);
        move(userId, j.price, "refund", jobId);
        return { result: "refunded", job: job(jobId) };
      });
    },

    // Admin: approve a refund waiting for review (or refund any finished job).
    forceRefund(jobId) {
      return tx(() => {
        const j = job(jobId);
        if (!j || !["done", "refund_review"].includes(j.status)) return false;
        run("UPDATE jobs SET status = 'refunded' WHERE id = ?", jobId);
        move(j.user_id, j.price, "refund", jobId);
        return true;
      });
    },

    grant(userId, amount) {
      this.user(userId);
      tx(() => move(userId, amount, "grant"));
      return one("SELECT * FROM users WHERE id = ?", userId);
    },

    running: () => db.prepare("SELECT * FROM jobs WHERE status = 'running'").all(),
    jobsOf: (userId, limit = 50) => db.prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, limit),
    ledgerOf: (userId, limit = 50) =>
      db.prepare("SELECT l.amount, l.kind, l.created_at, j.title FROM ledger l LEFT JOIN jobs j ON j.id = l.job_id WHERE l.user_id = ? ORDER BY l.id DESC LIMIT ?").all(userId, limit),
    quotesSince: (userId, since) => one("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND created_at >= ?", userId, since).n,

    // PDPA: delete everything about a user. Returns their evidence files so those can go too.
    deleteUser(userId) {
      return tx(() => {
        const files = db.prepare("SELECT evidence FROM jobs WHERE user_id = ? AND evidence != ''").all(userId).map((r) => r.evidence);
        run("DELETE FROM jobs WHERE user_id = ?", userId);
        run("DELETE FROM ledger WHERE user_id = ?", userId);
        run("DELETE FROM users WHERE id = ?", userId);
        return files;
      });
    },
  };
}
