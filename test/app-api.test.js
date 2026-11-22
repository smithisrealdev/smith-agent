import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDb, makeStore } from "../src/db.js";
import { createRunner } from "../src/runner.js";
import { createWeb } from "../src/web.js";
import { createLineLogin } from "../src/linelogin.js";
import { createPush } from "../src/push.js";

// The routes the phone app adds: native LINE / Apple sign-in, credit packs and push tokens.
const QUOTE = { doable: true, reason: "", title: "หาหูฟัง", steps: ["ค้น"], size: "M", cost: 0.3 };
const PACKS = [{ id: "credit_50", price: 59, credit: 50 }];
const A = "device-a-0123456789abcdef";
const B = "device-b-0123456789abcdef";

async function start(opts = {}) {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const runner = createRunner({ store, runTask: async () => ({ ok: true, answer: "ok", summary: "", sources: [], usage: { cost: 1 } }), screenshot: async () => false, log: { error() {} } });
  const alerts = { sent: [], send(m) { this.sent.push(m); }, once() {} };
  const handle = createWeb({ store, quote: async () => QUOTE, runner, alerts, log: { error() {} }, ...opts });
  const server = createServer(async (req, res) => (await handle(req, res)) || (res.writeHead(404), res.end()));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (token, method, path, body) => fetch(base + path, { method, headers: { ...(token && { Authorization: `Bearer ${token}` }), "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  return { store, alerts, call, base, close: () => server.close() };
}
const lineLogin = () => createLineLogin({ channelId: "165", channelSecret: "s", callbackUrl: "https://x/cb", fetchImpl: async (url, init) => {
  const idToken = new URLSearchParams(init.body).get("id_token");
  return { ok: idToken === "good", status: idToken === "good" ? 200 : 400, json: async () => ({ sub: "U77", aud: "165" }) };
} });
const apple = { verify: async (t, n) => { if (t !== "apple-good" || n !== "n1") throw new Error("bad"); return "apple:001"; }, refreshToken: async (c) => (c ? "rt-1" : null), revoked: [], async revoke(t) { this.revoked.push(t); } };

test("the app signs in with the LINE SDK token: same LINE user id as the bot, and a bad token is refused", async (t) => {
  const s = await start({ lineLogin: lineLogin() });
  t.after(s.close);
  assert.equal((await s.call(A, "POST", "/api/auth/line/native", { idToken: "bad" })).status, 401);
  assert.equal((await s.call(A, "GET", "/api/me")).status, 401);
  assert.equal((await s.call(A, "POST", "/api/auth/line/native", { idToken: "good" })).status, 200);
  assert.equal((await s.call(A, "GET", "/api/me")).body.id, "U77");
});

test("Sign in with Apple gives an apple: account; deleting it revokes Apple's token", async (t) => {
  const s = await start({ lineLogin: lineLogin(), apple });
  t.after(s.close);
  assert.equal((await s.call(A, "POST", "/api/auth/apple", { identityToken: "apple-good", nonce: "wrong" })).status, 401);
  assert.equal((await s.call(A, "POST", "/api/auth/apple", { identityToken: "apple-good", nonce: "n1", authorizationCode: "c" })).status, 200);
  const me = (await s.call(A, "GET", "/api/me")).body;
  assert.equal(me.id, "apple:001");
  assert.equal(me.apple, true);
  assert.equal(s.store.appleToken("apple:001"), "rt-1");
  assert.equal((await s.call(A, "DELETE", "/api/me")).status, 200);
  assert.deepEqual(apple.revoked, ["rt-1"]);
});

test("Apple alone turns on accounts: a phone without a session is not an account", async (t) => {
  const s = await start({ apple, inviteCode: "x" });
  t.after(s.close);
  assert.deepEqual((await s.call(A, "GET", "/api/me")).body, { error: "login" });
  assert.equal((await s.call(A, "POST", "/api/auth/line/native", { idToken: "good" })).status, 404, "no LINE Login configured");
});

test("a pack bought in the app adds credit once; a bad receipt adds nothing", async (t) => {
  const iap = { verify: async ({ receipt }) => { if (receipt !== "r1") throw new Error("forged"); return { platform: "ios", transactionId: "t1", productId: "credit_50", credit: 50 }; } };
  const s = await start({ iap, packs: PACKS });
  t.after(s.close);
  assert.deepEqual((await s.call(A, "GET", "/api/me")).body.packs, PACKS);
  assert.deepEqual(await s.call(A, "POST", "/api/purchase", { platform: "ios", productId: "credit_50", receipt: "x" }), { status: 402, body: { error: "receipt" } });
  assert.deepEqual((await s.call(A, "POST", "/api/purchase", { platform: "ios", productId: "credit_50", receipt: "r1" })).body, { added: 50, credit: 70 });
  assert.deepEqual((await s.call(B, "POST", "/api/purchase", { platform: "ios", productId: "credit_50", receipt: "r1" })).body, { added: 0, credit: 20 }, "another phone cannot reuse it");
  const off = await start();
  t.after(off.close);
  assert.equal((await off.call(A, "POST", "/api/purchase", {})).status, 404, "no store set up: the route is off");
  assert.equal((await off.call(A, "GET", "/api/me")).body.packs, undefined);
});

test("store refund notices tell the founder about purchases we credited, and nothing else", async (t) => {
  const iap = { verify: async () => ({ platform: "android", transactionId: "ptok", productId: "credit_50", credit: 50 }), appleNotification: async () => ({ type: "REFUND", transactionId: "nope" }) };
  const s = await start({ iap, packs: PACKS });
  t.after(s.close);
  await s.call(A, "POST", "/api/purchase", { platform: "android", productId: "credit_50", receipt: "ptok" });
  const rtdn = (token) => fetch(`${s.base}/iap/google/notify`, { method: "POST", body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify({ voidedPurchaseNotification: { purchaseToken: token } })).toString("base64") } }) });
  assert.equal((await rtdn("unknown")).status, 200);
  assert.equal(s.alerts.sent.length, 0);
  await rtdn("ptok");
  assert.equal(s.alerts.sent.length, 1);
  assert.match(s.alerts.sent[0], /Google Play คืนเงินแพ็ก credit_50/);
  assert.equal((await fetch(`${s.base}/iap/apple/notify`, { method: "POST", body: JSON.stringify({ signedPayload: "x" }) })).status, 200);
  assert.equal(s.alerts.sent.length, 1, "an Apple refund of a transaction we never credited");
});

test("the app registers its push token, and a finished job is pushed to it", async (t) => {
  const sent = [];
  let store;
  const push = { job: (job, r) => createPush({ store, fetchImpl: async (u, i) => (sent.push(JSON.parse(i.body)), { json: async () => ({ data: [] }) }) }).job(job, r) };
  const s = await start({ push });
  store = s.store;
  t.after(s.close);
  assert.equal((await s.call(A, "POST", "/api/push", { token: "not a token" })).status, 400);
  assert.equal((await s.call(A, "POST", "/api/push", { token: "ExponentPushToken[abcdefghij12]" })).status, 200);
  const q = await s.call(A, "POST", "/api/quote", { text: "หาหูฟัง" });
  await s.call(A, "POST", `/api/jobs/${q.body.job.id}/start`);
  for (let i = 0; i < 100 && !sent.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent[0][0].to, "ExponentPushToken[abcdefghij12]");
  assert.equal(sent[0][0].data.jobId, q.body.job.id);
});
