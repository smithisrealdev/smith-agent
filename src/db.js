import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SIZES, REFUND } from "./config.js";

// A short code a user puts in the PromptPay transfer note, so staff can tell whose transfer is whose in the bank app.
// The same for a user every time; 5 hex digits keep a clash unlikely in a test round of a few dozen people.
export const payRef = (userId) => `SM${createHash("sha256").update(String(userId)).digest("hex").slice(0, 5).toUpperCase()}`;

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
      refund_reason TEXT, -- what the user said was wrong, to improve the agent
      refund_tag TEXT,    -- 'price' when the claim was "the price is not what the page shows"
      options TEXT,       -- the choices the agent found, as JSON, shown as cards
      codes TEXT,         -- discount codes the agent saw on pages, as JSON
      coverage TEXT       -- what the agent opened: searches, pages, sites read, sites it could not read (JSON)
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, job_id INTEGER,
      amount INTEGER NOT NULL, -- credit in baht, + adds to the user's balance
      kind TEXT NOT NULL,      -- start | grant | topup | hold | release | refund
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS topups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL, -- baht the user says they transferred (the configured amount, never what the client sends)
      status TEXT NOT NULL,    -- pending | approved | rejected
      created_at TEXT NOT NULL, decided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY,     -- hash of the phone's random token
      user_id TEXT NOT NULL,    -- the LINE user it signed in as
      created_at TEXT NOT NULL
    );
  `);
  // Databases made by an earlier version lack the newer columns: add them in place.
  const have = new Set(db.prepare("PRAGMA table_info(jobs)").all().map((c) => c.name));
  for (const col of ["refund_reason", "refund_tag", "options", "codes", "coverage"]) if (!have.has(col)) db.exec(`ALTER TABLE jobs ADD COLUMN ${col} TEXT`);
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
    known: (id) => Boolean(one("SELECT 1 FROM users WHERE id = ?", id)),
    userCount: () => one("SELECT COUNT(*) AS n FROM users").n,
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

    // Success keeps the hold as the charge; failure gives it back ("no charge when it fails"), and so does the user taking over.
    finish(jobId, r) {
      return tx(() => {
        const j = job(jobId);
        if (!j || j.status !== "running") return j;
        const u = r.usage || {};
        run(
          `UPDATE jobs SET status = ?, finished_at = ?, run_cost = ?, input_tokens = ?, output_tokens = ?, searches = ?,
             answer = ?, sources = ?, options = ?, codes = ?, coverage = ?, evidence = ?, error = ? WHERE id = ?`,
          r.ok ? "done" : r.error === "taken_over" ? "cancelled" : "failed", iso(), u.cost || 0, u.input_tokens || 0, u.output_tokens || 0, u.searches || 0,
          r.answer || "", JSON.stringify(r.sources || []), JSON.stringify(r.options || []), JSON.stringify(r.codes || []),
          r.coverage ? JSON.stringify(r.coverage) : "", r.evidence || "", r.error || "", jobId,
        );
        if (!r.ok) move(j.user_id, j.price, "release", jobId);
        return job(jobId);
      });
    },

    // "Wrong result" refund: automatic within the window up to the monthly cap, otherwise queued for a person.
    refund(userId, jobId, reason = "", { price = false } = {}) {
      return tx(() => {
        const j = one("SELECT * FROM jobs WHERE id = ? AND user_id = ?", jobId, userId);
        if (!j) return { result: "not_found" };
        if (["refunded", "refund_review"].includes(j.status)) return { result: "already", job: j };
        if (j.status !== "done") return { result: "not_charged", job: j };
        if (now() - Date.parse(j.finished_at) > REFUND.windowHours * 3600e3) return { result: "expired", job: j };
        // Price claims are counted apart from the rest: a wrong price is Smith's own mistake, so it gets more room.
        const tag = price ? "price" : "";
        const month = iso().slice(0, 7);
        const used = one(
          `SELECT COUNT(*) AS n FROM ledger l JOIN jobs x ON x.id = l.job_id
           WHERE l.user_id = ? AND l.kind = 'refund' AND l.created_at >= ? AND COALESCE(x.refund_tag, '') = ?`,
          userId, month, tag,
        ).n;
        if (used >= (price ? REFUND.priceAutoPerMonth : REFUND.autoPerMonth)) {
          run("UPDATE jobs SET status = 'refund_review', refund_reason = ?, refund_tag = ? WHERE id = ?", reason, tag, jobId);
          return { result: "review", job: job(jobId) };
        }
        run("UPDATE jobs SET status = 'refunded', refund_reason = ?, refund_tag = ? WHERE id = ?", reason, tag, jobId);
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

    // A user says they paid by PromptPay. One request waits at a time: tapping again returns the waiting one.
    requestTopup(userId, amount) {
      this.user(userId);
      return tx(() => {
        const waiting = one("SELECT * FROM topups WHERE user_id = ? AND status = 'pending'", userId);
        if (waiting) return waiting;
        const { lastInsertRowid } = run("INSERT INTO topups (user_id, amount, status, created_at) VALUES (?, ?, 'pending', ?)", userId, amount, iso());
        return { ...one("SELECT * FROM topups WHERE id = ?", Number(lastInsertRowid)), fresh: true }; // fresh: staff should hear about it
      });
    },
    // Staff checked the bank app: credit the money (approve) or turn the claim down. Only a waiting request changes.
    decideTopup(id, approve) {
      return tx(() => {
        const t = one("SELECT * FROM topups WHERE id = ? AND status = 'pending'", id);
        if (!t) return null;
        run("UPDATE topups SET status = ?, decided_at = ? WHERE id = ?", approve ? "approved" : "rejected", iso(), id);
        if (approve) move(t.user_id, t.amount, "topup");
        return { ...one("SELECT * FROM topups WHERE id = ?", id), credit: one("SELECT credit FROM users WHERE id = ?", t.user_id).credit };
      });
    },
    pendingTopups: () => db.prepare("SELECT * FROM topups WHERE status = 'pending' ORDER BY id").all(),
    topupsOf: (userId, limit = 5) => db.prepare("SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, limit),

    grant(userId, amount) {
      this.user(userId);
      tx(() => move(userId, amount, "grant"));
      return one("SELECT * FROM users WHERE id = ?", userId);
    },

    // Claude cost (baht) of the quotes and jobs made since midnight in Thailand: what the daily cap is checked against.
    spentToday() {
      const day = 86400e3;
      const midnight = new Date(Math.floor((now().getTime() + 7 * 3600e3) / day) * day - 7 * 3600e3).toISOString();
      return one("SELECT COALESCE(SUM(quote_cost + run_cost), 0) AS n FROM jobs WHERE created_at >= ?", midnight).n;
    },

    running: () => db.prepare("SELECT * FROM jobs WHERE status = 'running'").all(),
    jobsOf: (userId, limit = 50) => db.prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, limit),
    ledgerOf: (userId, limit = 50) =>
      db.prepare("SELECT l.amount, l.kind, l.created_at, j.title FROM ledger l LEFT JOIN jobs j ON j.id = l.job_id WHERE l.user_id = ? ORDER BY l.id DESC LIMIT ?").all(userId, limit),
    sessionUser: (key) => one("SELECT user_id FROM sessions WHERE key = ?", key)?.user_id ?? null,
    signIn: (key, userId) => run("INSERT OR REPLACE INTO sessions (key, user_id, created_at) VALUES (?, ?, ?)", key, userId, iso()),
    signOut: (key) => run("DELETE FROM sessions WHERE key = ?", key),
    quotesSince: (userId, since) => one("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND created_at >= ?", userId, since).n,

    // PDPA: delete everything about a user. Returns their evidence files (screenshots, product pictures) so those can go too.
    deleteUser(userId) {
      return tx(() => {
        const rows = db.prepare("SELECT evidence, options FROM jobs WHERE user_id = ?").all(userId);
        const files = rows.flatMap((r) => [r.evidence, ...JSON.parse(r.options || "[]").map((o) => o.image)]).filter(Boolean);
        run("DELETE FROM jobs WHERE user_id = ?", userId);
        run("DELETE FROM ledger WHERE user_id = ?", userId);
        run("DELETE FROM topups WHERE user_id = ?", userId);
        run("DELETE FROM users WHERE id = ?", userId);
        run("DELETE FROM sessions WHERE user_id = ?", userId);
        return files;
      });
    },
  };
}
