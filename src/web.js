import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { SIZES, REFUND } from "./config.js";
import { payRef } from "./db.js";
import { createAlerts, ALERT } from "./alerts.js";
import { createChat } from "./chat.js";
import { createTalk } from "./talk.js";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};
const CHAT_STATUS = { status: 409, text: 400, limit: 429, busy: 503, chat_busy: 409 }; // chat refusals from src/chat.js, as HTTP
const TALK_STATUS = { text: 400, rate: 429, busy: 503, talk_busy: 409 }; // the chat before a job (src/talk.js), as HTTP
const APP_FILES = new Set(["index.html", "app.js", "app.css", "mascots.js", "icons.js", "manifest.webmanifest", "icon.svg", "icon-180.png", "sw.js"]);

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
    options: JSON.parse(j.options || "[]"),
    codes: JSON.parse(j.codes || "[]"),
    coverage: j.coverage ? JSON.parse(j.coverage) : null,
    evidence: j.evidence || "",
    parentId: j.parent_id ?? null, // a re-search: the job it continues
    chat: JSON.parse(j.chat || "[]"),
    createdAt: j.created_at,
    startedAt: j.started_at,
    finishedAt: j.finished_at,
  };
}

// The phone app's API. A phone keeps a random token and the server stores only its hash (the "key").
// Without LINE Login the key is the account; with it, the key must be signed in to a LINE user first.
export function createWeb({ store, quote, chat, chats = null, talk, talks = null, runner, lineLogin = null, apple = null, iap = null, packs = [], push = null, notify = null, publicDir = "public", evidenceDir = "data/evidence", inviteCode = "", quotesPerHour = 30, dailyCostCap = 0, maxUsers = 0, topup = null, alerts = createAlerts(), now = () => new Date(), log = console }) {
  const full = () => {
    const over = dailyCostCap > 0 && store.spentToday() >= dailyCostCap; // today's Claude budget is used up
    if (over) alerts.once("cap", ALERT.cap(dailyCostCap));
    return over;
  };
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
    return true;
  };
  const keyOf = (req) => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || "");
    return m ? createHash("sha256").update(m[1]).digest("hex").slice(0, 32) : null;
  };
  const redirect = (res, location) => {
    res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
    res.end();
    return true;
  };
  const body = async (req, max = 10_000) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > max) throw Object.assign(new Error("body too large"), { status: 413 });
      chunks.push(chunk);
    }
    try {
      return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    } catch {
      throw Object.assign(new Error("bad json"), { status: 400 });
    }
  };
  const credit = (userId) => store.user(userId).credit;
  const closed = (userId) => maxUsers > 0 && !store.known(userId) && store.userCount() >= maxUsers; // the test round is full
  // The chat rules are shared with the LINE bot (server.js passes one `chats`); tests may pass only the model's `chat`.
  chats ??= createChat({ store, chat, full, now });
  talks ??= createTalk({ store, talk, full, perHour: quotesPerHour, now });
  // The chat before a job, newest last; a job reply carries that job's current state for its card.
  const talkView = (userId) => store.talkOf(userId, 50).map((e) => {
    const j = e.job && store.job(e.job);
    return { role: e.role, text: e.text, at: e.at, job: j ? { id: j.id, status: j.status, price: j.price, title: j.title } : null };
  });
  // A re-search started from the chat shows there as a card, so its entry carries that job's current state.
  const withChildren = (v) => ({
    ...v,
    chat: v.chat.map((e) => {
      const c = e.job && store.job(e.job);
      return c ? { ...e, child: { id: c.id, status: c.status, price: c.price, title: c.title, steps: JSON.parse(c.steps || "[]") } } : e;
    }),
  });
  const view = (j) => withChildren(j.status === "running" ? { ...jobView(j), progress: runner.progress(j.id), live: runner.watching(j.id) } : { ...jobView(j), progress: [] });
  const ownJob = (userId, id) => {
    const j = store.job(id);
    return j && j.user_id === userId ? j : null;
  };
  const sendFile = async (res, file, type, cache = "no-cache") => {
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": type, "Cache-Control": cache });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return true;
  };

  async function api(req, res, path, userId) {
    const m = /^\/api\/jobs\/(\d+)(?:\/(start|cancel|takeover|chat|refund))?$/.exec(path);
    const id = m && Number(m[1]);

    if (req.method === "GET" && path === "/api/me") return json(res, 200, { id: userId, credit: credit(userId), login: lineLogin ? "line" : null, prices: { S: SIZES.S.price, M: SIZES.M.price, L: SIZES.L.price }, topup: topup && { ...topup, ref: payRef(userId) }, ...(apple && { apple: true }), ...(iap && { packs }) });

    // A credit pack bought in the phone app: the store's receipt is checked before any credit is added, once per transaction.
    if (req.method === "POST" && path === "/api/purchase") {
      if (!iap) return json(res, 404, { error: "not_found" });
      const { platform, productId, receipt } = await body(req, 20_000);
      let p;
      try {
        p = await iap.verify({ platform, productId, receipt });
      } catch (err) {
        log.error("purchase refused:", err.message);
        return json(res, 402, { error: "receipt" });
      }
      return json(res, 200, store.addPurchase(userId, p));
    }

    if (req.method === "POST" && path === "/api/push") {
      const token = String((await body(req)).token || "");
      if (!/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/.test(token)) return json(res, 400, { error: "token" });
      store.addPushToken(userId, token);
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && path === "/api/topup") {
      if (!topup) return json(res, 404, { error: "not_found" });
      const t = store.requestTopup(userId, topup.amount);
      if (t.fresh) alerts.send(ALERT.topup(t, payRef(userId)));
      return json(res, 200, { topup: t, credit: credit(userId) });
    }

    if (req.method === "DELETE" && path === "/api/me") {
      if (apple && userId.startsWith("apple:")) await apple.revoke(store.appleToken(userId)).catch((err) => log.error("Apple revoke failed:", err.message));
      for (const file of store.deleteUser(userId)) await rm(join(evidenceDir, basename(file)), { force: true });
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && path === "/api/jobs") return json(res, 200, { jobs: store.jobsOf(userId).map(view) });

    if (req.method === "GET" && path === "/api/ledger") return json(res, 200, { credit: credit(userId), entries: store.ledgerOf(userId), topups: store.topupsOf(userId) });

    // The order box: a free answer, or a quoted job that is charged only on start.
    if (req.method === "GET" && path === "/api/talk") return json(res, 200, { talk: talkView(userId) });
    if (req.method === "POST" && path === "/api/talk") {
      const r = await talks.say(userId, (await body(req)).text);
      if (r.error) return json(res, TALK_STATUS[r.error], { error: r.error });
      return json(res, 200, { job: r.job && jobView(r.job), talk: talkView(userId), credit: credit(userId) });
    }

    if (req.method === "POST" && path === "/api/quote") {
      const text = String((await body(req)).text || "").trim();
      if (!text || text.length > 1000) return json(res, 400, { error: "text" });
      store.user(userId);
      const hourAgo = new Date(now() - 3600e3).toISOString();
      if (store.quotesSince(userId, hourAgo) >= quotesPerHour) return json(res, 429, { error: "rate" });
      if (full()) return json(res, 503, { error: "busy" });
      const job = store.addQuote(userId, text, await quote(text));
      return json(res, 200, { job: jobView(job), credit: credit(userId) });
    }

    if (m && !m[2] && req.method === "GET") {
      const j = ownJob(userId, id);
      return j ? json(res, 200, { job: view(j), credit: credit(userId) }) : json(res, 404, { error: "not_found" });
    }

    if (m && m[2] && req.method === "POST") {
      if (!ownJob(userId, id)) return json(res, 404, { error: "not_found" });
      if (m[2] === "start") {
        if (full()) return json(res, 503, { error: "busy", credit: credit(userId) }); // not started, so nothing is charged
        const r = store.start(userId, id);
        if (!r.ok) return json(res, 409, { error: r.reason, credit: credit(userId) });
        // The app polls the job for the result; LINE users also get it in their chat.
        // A user who took over is in the app already: no LINE message about it.
        runner.run(r.job).then((done) => done.r.error !== "taken_over" && Promise.all([notify?.(done.job, done.r), push?.job(done.job, done.r)])).catch((err) => log.error("job failed", id, err));
        return json(res, 200, { job: jobView(r.job), credit: credit(userId) });
      }
      if (m[2] === "cancel") return json(res, 200, { ok: store.cancel(userId, id) });
      if (m[2] === "takeover") {
        const page = await runner.stop(id);
        return json(res, 200, { ok: page !== null, url: page || "", credit: credit(userId) });
      }
      // The chat under a result: an answer from what Smith found, or a re-search card that waits for a tap.
      if (m[2] === "chat") {
        const r = await chats.ask(id, (await body(req)).text); // the job is read after the body, so the question count is current
        if (r.error) return json(res, CHAT_STATUS[r.error], { error: r.error });
        return json(res, 200, { job: view(r.job), credit: credit(userId) });
      }
      const { reasons = [], note = "" } = await body(req);
      const why = [...(Array.isArray(reasons) ? reasons : []), note].map((s) => String(s).trim()).filter(Boolean).join(" · ").slice(0, 500);
      const r = store.refund(userId, id, why, { price: Array.isArray(reasons) && reasons.includes(REFUND.priceReason) });
      if (r.result === "review") alerts.send(ALERT.review(r.job, why));
      return json(res, 200, { result: r.result, job: r.job ? jobView(store.job(id)) : null, credit: credit(userId) });
    }

    return json(res, 404, { error: "not_found" });
  }

  // Returns true when it answered the request.
  // LINE sends the browser back here after sign-in (or after the user cancels).
  async function lineCallback(res, q) {
    try {
      if (q.get("error")) throw new Error(`LINE said ${q.get("error")}`);
      const { key, userId } = await lineLogin.finish(q.get("state") || "", q.get("code") || "");
      if (closed(userId)) return redirect(res, "/#/full");
      store.user(userId);
      store.signIn(key, userId);
      return redirect(res, "/#/");
    } catch (err) {
      log.error("LINE login failed:", err.message);
      return redirect(res, "/#/login?e=1");
    }
  }

  // The phone app signed in with the LINE SDK or with Apple: the token from the device decides the account.
  const signInAs = (res, key, userId) => {
    if (closed(userId)) return json(res, 403, { error: "full" });
    store.user(userId);
    store.signIn(key, userId);
    return json(res, 200, { ok: true });
  };
  async function nativeSignIn(req, res, key, how) {
    const b = await body(req);
    let userId;
    try {
      userId = how === "line" ? await lineLogin.verifyNative(b.idToken) : await apple.verify(b.identityToken, b.nonce);
    } catch (err) {
      log.error(`${how} sign-in refused:`, err.message);
      return json(res, 401, { error: "login" });
    }
    if (how === "apple") {
      const rt = await apple.refreshToken(b.authorizationCode).catch((err) => log.error("Apple code exchange failed:", err.message));
      if (rt) store.setAppleToken(userId, rt);
    }
    return signInAs(res, key, userId);
  }

  // The stores tell us about refunds. Credit is not taken back by itself: the founder hears about it and decides.
  async function storeNotice(req, res, platform) {
    try {
      const b = await body(req, 200_000);
      let id = "";
      if (platform === "ios") {
        const n = await iap.appleNotification(b.signedPayload);
        if (["REFUND", "REVOKE"].includes(n.type)) id = n.transactionId;
      } else {
        const m = JSON.parse(Buffer.from(b.message?.data || "", "base64").toString() || "{}");
        id = m.voidedPurchaseNotification?.purchaseToken || ""; // only tokens we credited are reported, so a stranger's post says nothing
      }
      const p = id && store.purchase(platform, id);
      if (p) alerts.send(ALERT.storeRefund(p));
    } catch (err) {
      log.error("store notice refused:", err.message);
      return json(res, 400, { error: "notice" });
    }
    return json(res, 200, { ok: true });
  }

  return async function handle(req, res) {
    const url = new URL(req.url, "http://local");
    const path = url.pathname;
    const notice = req.method === "POST" && iap && /^\/iap\/(apple|google)\/notify$/.exec(path);
    if (notice) return storeNotice(req, res, notice[1] === "apple" ? "ios" : "android");

    if (req.method === "GET" && path === "/auth/line/callback" && lineLogin) return lineCallback(res, url.searchParams);

    if (req.method === "GET" && !path.startsWith("/api/")) {
      const evidence = /^\/evidence\/(\d+-[0-9a-f]{24}\.(?:png|jpg|webp))$/.exec(path); // screenshots and product pictures
      if (evidence) return sendFile(res, join(evidenceDir, evidence[1]), TYPES[extname(evidence[1])], "private, max-age=604800");
      const logo = /^\/logo\/([a-z0-9-]+(?:\.[a-z0-9-]+)+\.png)$/.exec(path); // a site's logo, saved when a job finished
      if (logo) return sendFile(res, join(evidenceDir, "logos", logo[1]), TYPES[".png"], "public, max-age=604800");
      const name = path === "/" ? "index.html" : path.slice(1);
      return APP_FILES.has(name) ? sendFile(res, join(publicDir, name), TYPES[extname(name)]) : false;
    }
    if (!path.startsWith("/api/")) return false;

    // While testing with people outside the team, an invite code keeps strangers from spending your Claude credit.
    // With LINE Login on, signing in with LINE is the key instead (as in the LINE bot): a LINE account can start at once,
    // and MAX_USERS caps how many accounts the test round takes.
    const accounts = Boolean(lineLogin || apple); // sign-in decides the account, not the phone
    if (inviteCode && !accounts && req.headers["x-invite"] !== inviteCode) return json(res, 403, { error: "invite" });
    const key = keyOf(req);
    if (!key) return json(res, 401, { error: "auth" });
    if (req.method === "POST" && path === "/api/auth/line/native") return lineLogin ? nativeSignIn(req, res, key, "line") : json(res, 404, { error: "not_found" });
    if (req.method === "POST" && path === "/api/auth/apple") return apple ? nativeSignIn(req, res, key, "apple") : json(res, 404, { error: "not_found" });
    if (req.method === "POST" && path === "/api/auth/line") return lineLogin ? json(res, 200, { url: lineLogin.start(key) }) : json(res, 404, { error: "not_found" });
    if (req.method === "POST" && path === "/api/logout") {
      store.signOut(key);
      return json(res, 200, { ok: true });
    }
    const userId = accounts ? store.sessionUser(key) : `web:${key}`;
    if (!userId) return json(res, 401, { error: "login" });
    if (closed(userId)) return json(res, 403, { error: "full" });
    try {
      return await api(req, res, path, userId);
    } catch (err) {
      if (err.status) return json(res, err.status, { error: err.message });
      log.error("api failed", path, err);
      return json(res, 500, { error: "server" });
    }
  };
}
