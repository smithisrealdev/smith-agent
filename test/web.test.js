import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, makeStore } from "../src/db.js";
import { createRunner } from "../src/runner.js";
import { createWeb } from "../src/web.js";
import { createLineLogin } from "../src/linelogin.js";
import { createAlerts } from "../src/alerts.js";
import { createBot } from "../src/bot.js";
import { createChat } from "../src/chat.js";
import { SIZES } from "../src/config.js";

const QUOTE = { doable: true, reason: "", title: "เทียบราคาหูฟัง", steps: ["ค้น 3 ร้าน", "เทียบราคา"], size: "M", cost: 0.3 };
const RESULT = { ok: true, answer: "ร้าน B ถูกสุด ฿8,990", summary: "เจอแล้ว", sources: [{ title: "B", url: "https://b.example/x" }], bestUrl: "", usage: { cost: 3 } };

async function start({ quote = async () => QUOTE, runTask = async () => RESULT, saveImages, ...opts } = {}) {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const runner = createRunner({ store, runTask, screenshot: async () => false, saveImages, evidenceDir: opts.evidenceDir, log: { error() {} } });
  const handle = createWeb({ store, quote, runner, log: { error() {} }, ...opts });
  const server = createServer(async (req, res) => {
    if (!(await handle(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (token, method, path, body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: { ...(token && { Authorization: `Bearer ${token}` }), "Content-Type": "application/json", ...headers },
      body: body && JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() }));
  return { store, base, call, close: () => server.close() };
}
const A = "device-a-0123456789abcdef";
const B = "device-b-0123456789abcdef";
const waitFor = async (fn) => {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out");
};

test("the app is served, and the API needs a device token", async (t) => {
  const s = await start();
  t.after(s.close);
  const page = await fetch(s.base + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.equal((await fetch(s.base + "/package.json")).status, 404, "only the app's own files are served");
  assert.equal((await s.call(null, "GET", "/api/me")).status, 401);
  assert.equal((await s.call("short", "GET", "/api/me")).status, 401);
  const me = await s.call(A, "GET", "/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.credit, 20);
  assert.match(me.body.id, /^web:[0-9a-f]{32}$/);
  assert.ok(!me.body.id.includes(A), "the raw token is never stored");
});

test("quote, start, poll until done: charged only on success", async (t) => {
  const s = await start();
  t.after(s.close);
  const q = await s.call(A, "POST", "/api/quote", { text: "เทียบราคาหูฟัง Sony 3 ร้าน" });
  assert.equal(q.status, 200);
  assert.equal(q.body.job.status, "quoted");
  assert.equal(q.body.job.price, 9);
  assert.deepEqual(q.body.job.steps, ["ค้น 3 ร้าน", "เทียบราคา"]);
  assert.equal(q.body.job.cost, undefined, "costs stay on the server");

  const id = q.body.job.id;
  const started = await s.call(A, "POST", `/api/jobs/${id}/start`);
  assert.equal(started.status, 200);
  assert.equal(started.body.credit, 11);
  const done = await waitFor(async () => {
    const r = await s.call(A, "GET", `/api/jobs/${id}`);
    return r.body.job.status === "done" && r.body;
  });
  assert.equal(done.job.answer, "ร้าน B ถูกสุด ฿8,990");
  assert.deepEqual(done.job.sources, [{ title: "B", url: "https://b.example/x" }]);
  assert.equal(done.credit, 11);
  assert.equal((await s.call(A, "POST", `/api/jobs/${id}/start`)).status, 409, "no second charge");

  const list = await s.call(A, "GET", "/api/jobs");
  assert.deepEqual(list.body.jobs.map((j) => j.id), [id]);
  const ledger = await s.call(A, "GET", "/api/ledger");
  assert.deepEqual(ledger.body.entries.map((e) => [e.kind, e.amount]), [["hold", -9], ["start", 20]]);
});

test("a failed job is free and says why", async (t) => {
  const s = await start({ runTask: async () => ({ ok: false, summary: "เว็บร้านค้าปิดปรับปรุง", sources: [], usage: { cost: 1 } }) });
  t.after(s.close);
  const { body } = await s.call(A, "POST", "/api/quote", { text: "หาของ" });
  await s.call(A, "POST", `/api/jobs/${body.job.id}/start`);
  const failed = await waitFor(async () => {
    const r = await s.call(A, "GET", `/api/jobs/${body.job.id}`);
    return r.body.job.status === "failed" && r.body;
  });
  assert.equal(failed.job.answer, "เว็บร้านค้าปิดปรับปรุง");
  assert.equal(failed.credit, 20);
});

test("one device cannot see or touch another device's jobs", async (t) => {
  const s = await start();
  t.after(s.close);
  const { body } = await s.call(A, "POST", "/api/quote", { text: "หาของ" });
  for (const [method, path] of [["GET", ""], ["POST", "/start"], ["POST", "/cancel"], ["POST", "/refund"]]) {
    assert.equal((await s.call(B, method, `/api/jobs/${body.job.id}${path}`)).status, 404, `${method} ${path}`);
  }
  assert.deepEqual((await s.call(B, "GET", "/api/jobs")).body.jobs, []);
  assert.equal(s.store.job(body.job.id).status, "quoted");
});

test("refund keeps what the user said was wrong", async (t) => {
  const s = await start();
  t.after(s.close);
  const { body } = await s.call(A, "POST", "/api/quote", { text: "หาของ" });
  await s.call(A, "POST", `/api/jobs/${body.job.id}/start`);
  await waitFor(async () => (await s.call(A, "GET", `/api/jobs/${body.job.id}`)).body.job.status === "done");
  const r = await s.call(A, "POST", `/api/jobs/${body.job.id}/refund`, { reasons: ["ราคาไม่ตรงกับหน้าเว็บ"], note: "ร้าน B ขึ้นราคาแล้ว" });
  assert.equal(r.body.result, "refunded");
  assert.equal(r.body.credit, 20);
  assert.equal(r.body.job.status, "refunded");
  assert.equal(s.store.job(body.job.id).refund_reason, "ราคาไม่ตรงกับหน้าเว็บ · ร้าน B ขึ้นราคาแล้ว");
});

test("not enough credit, bad input, and the hourly quote limit", async (t) => {
  const s = await start({ quote: async () => ({ ...QUOTE, size: "L" }), quotesPerHour: 2 });
  t.after(s.close);
  const one = await s.call(A, "POST", "/api/quote", { text: "งาน 1" });
  await s.call(A, "POST", `/api/jobs/${one.body.job.id}/start`);
  const two = await s.call(A, "POST", "/api/quote", { text: "งาน 2" });
  const r = await s.call(A, "POST", `/api/jobs/${two.body.job.id}/start`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "credit");
  assert.equal((await s.call(A, "POST", "/api/quote", { text: "งาน 3" })).status, 429);
  assert.equal((await s.call(B, "POST", "/api/quote", { text: "" })).status, 400);
  assert.equal((await s.call(B, "POST", "/api/quote", { text: "x".repeat(1001) })).status, 400);
});

test("an invite code keeps strangers out when it is set", async (t) => {
  const s = await start({ inviteCode: "smith-test" });
  t.after(s.close);
  assert.equal((await s.call(A, "GET", "/api/me")).status, 403);
  assert.equal((await s.call(A, "GET", "/api/me", null, { "X-Invite": "wrong" })).status, 403);
  assert.equal((await s.call(A, "GET", "/api/me", null, { "X-Invite": "smith-test" })).status, 200);
});

test("deleting the account removes the user's jobs and credit history", async (t) => {
  const s = await start();
  t.after(s.close);
  await s.call(A, "POST", "/api/quote", { text: "หาของ" });
  assert.equal((await s.call(A, "DELETE", "/api/me")).status, 200);
  const db = s.store;
  assert.equal(db.jobsOf((await s.call(A, "GET", "/api/me")).body.id).length, 0);
  assert.deepEqual((await s.call(A, "GET", "/api/ledger")).body.entries.map((e) => e.kind), ["start"], "a fresh account");
});

test("with LINE Login on, a phone must sign in, and the account follows the LINE user to another phone", async (t) => {
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => (url.endsWith("/token") ? { id_token: "idt" } : { sub: "U77", aud: "165" }) });
  const lineLogin = createLineLogin({ channelId: "165", channelSecret: "s", callbackUrl: "https://smith.example/auth/line/callback", fetchImpl });
  const notified = [];
  const s = await start({ lineLogin, notify: async (job, r) => notified.push([job.id, job.user_id, r.ok]) });
  t.after(s.close);
  const signIn = async (token) => {
    const { body } = await s.call(token, "POST", "/api/auth/line");
    const state = new URL(body.url).searchParams.get("state");
    return fetch(`${s.base}/auth/line/callback?code=abc&state=${state}`, { redirect: "manual" });
  };

  assert.deepEqual((await s.call(A, "GET", "/api/me")).body, { error: "login" });
  assert.equal((await s.call(A, "POST", "/api/quote", { text: "x" })).status, 401);
  const back = await signIn(A);
  assert.equal(back.status, 302);
  assert.equal(back.headers.get("location"), "/#/");
  const me = await s.call(A, "GET", "/api/me");
  assert.deepEqual(me.body, { id: "U77", credit: 20, login: "line", prices: { S: 5, M: 9, L: 15 }, topup: null });

  const { body } = await s.call(A, "POST", "/api/quote", { text: "หาของ" });
  await s.call(A, "POST", `/api/jobs/${body.job.id}/start`);
  await waitFor(async () => (await s.call(A, "GET", `/api/jobs/${body.job.id}`)).body.job.status === "done");
  await waitFor(async () => notified.length === 1);
  assert.deepEqual(notified, [[body.job.id, "U77", true]], "the result also goes to the LINE chat");

  await signIn(B);
  assert.deepEqual((await s.call(B, "GET", "/api/jobs")).body.jobs.map((j) => j.id), [body.job.id], "same account on the second phone");
  assert.equal((await s.call(B, "GET", "/api/me")).body.credit, 11);

  assert.equal((await s.call(A, "POST", "/api/logout")).status, 200);
  assert.equal((await s.call(A, "GET", "/api/me")).status, 401, "signed out on phone A");
  assert.equal((await s.call(B, "GET", "/api/me")).status, 200, "phone B stays signed in");

  const cancelled = await fetch(`${s.base}/auth/line/callback?error=access_denied&state=x`, { redirect: "manual" });
  assert.equal(cancelled.headers.get("location"), "/#/login?e=1");

  assert.equal((await s.call(B, "DELETE", "/api/me")).status, 200);
  assert.equal((await s.call(B, "GET", "/api/me")).status, 401, "deleting the account ends every session");
});

test("without LINE Login there is no sign-in route", async (t) => {
  const s = await start();
  t.after(s.close);
  assert.equal((await s.call(A, "POST", "/api/auth/line")).status, 404);
  assert.equal((await fetch(`${s.base}/auth/line/callback?code=a&state=b`)).status, 404);
  assert.equal((await s.call(A, "GET", "/api/me")).body.login, null);
});

test("a running job shows live steps, and a finished one shows its option cards", async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const runTask = async (job, _client, _today, onProgress) => {
    onProgress('ค้นหา "หูฟัง Sony"');
    onProgress("เปิดอ่าน shop-b.example");
    await gate;
    return { ...RESULT, options: [{ name: "ร้าน B", price: "฿8,990", note: "ส่งฟรี", url: "https://b.example/x" }] };
  };
  const s = await start({ runTask });
  t.after(s.close);
  const { body } = await s.call(A, "POST", "/api/quote", { text: "หาของ" });
  await s.call(A, "POST", `/api/jobs/${body.job.id}/start`);
  const running = await s.call(A, "GET", `/api/jobs/${body.job.id}`);
  assert.equal(running.body.job.status, "running");
  assert.deepEqual(running.body.job.progress.map((p) => p.text), ['ค้นหา "หูฟัง Sony"', "เปิดอ่าน shop-b.example"]);
  assert.deepEqual((await s.call(A, "GET", "/api/jobs")).body.jobs[0].progress.length, 2, "the list carries it too, for the home card");
  release();
  const done = await waitFor(async () => {
    const r = await s.call(A, "GET", `/api/jobs/${body.job.id}`);
    return r.body.job.status === "done" && r.body.job;
  });
  assert.deepEqual(done.progress, [], "steps are dropped once the job is finished");
  assert.deepEqual(done.options, [{ name: "ร้าน B", price: "฿8,990", note: "ส่งฟรี", url: "https://b.example/x", brand: "b.example" }]);
});

test("a finished job saves its sites' logos, and /logo/ serves only those files", async (t) => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "smith-"));
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const saved = [];
  const saveLogos = async (urls, dir) => {
    saved.push(urls);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "b.example.png"), "png");
    return ["b.example"];
  };
  const runTask = async (_job, _client, _today, onProgress) => {
    onProgress('ค้นหา "x"');
    onProgress("เปิดอ่าน b.example", "https://www.b.example/y");
    assert.deepEqual(runner.progress(1).map((p) => p.host), ["", "b.example"], "a page-read step carries its site, for the logo");
    return { ...RESULT, options: [{ name: "B", price: "", note: "", url: "https://b.example/y" }, { name: "C", price: "", note: "", url: "https://c.example/", brand: "air.example" }] };
  };
  const runner = createRunner({ store, runTask, screenshot: async () => false, saveLogos, evidenceDir, log: { error() {} } });
  const handle = createWeb({ store, quote: async () => QUOTE, runner, evidenceDir, log: { error() {} } });
  const server = createServer(async (req, res) => (await handle(req, res)) || res.writeHead(404).end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { job } = await runner.run(store.start("u", store.addQuote(store.user("u").id, "x", QUOTE).id).job);
  assert.deepEqual(saved, [["https://www.b.example/y"], ["https://b.example/x", "https://b.example/y", "https://c.example/", "https://b.example/", "https://air.example/"]], "once while the page is read, once at the end");
  assert.deepEqual(JSON.parse(job.options).map((o) => o.logo), ["/logo/b.example.png", undefined], "an option knows whether its shop has a logo");
  const ok = await fetch(`${base}/logo/b.example.png`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  for (const path of ["/logo/other.example.png", "/logo/..%2Fsecret.png", "/logo/b.example.png/..", "/logo/B.example.png"]) assert.equal((await fetch(base + path)).status, 404, path);
});

test("product pictures are served like evidence, and deleting the account deletes them", async (t) => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "smith-"));
  const name = `1-${"ab".repeat(12)}.jpg`;
  const saveImages = async (options, dir) => {
    writeFileSync(join(dir, name), "jpg");
    options[0].image = `/evidence/${name}`;
  };
  const s = await start({ runTask: async () => ({ ...RESULT, options: [{ name: "B", price: "", note: "", url: "https://b.example/y" }] }), saveImages, evidenceDir });
  t.after(s.close);
  const { body } = await s.call(A, "POST", "/api/quote", { text: "หาของ" });
  await s.call(A, "POST", `/api/jobs/${body.job.id}/start`);
  const job = await waitFor(async () => {
    const r = await s.call(A, "GET", `/api/jobs/${body.job.id}`);
    return r.body.job.status === "done" && r.body.job;
  });
  assert.equal(job.options[0].image, `/evidence/${name}`);
  const got = await fetch(s.base + job.options[0].image);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/jpeg");
  assert.equal((await s.call(A, "DELETE", "/api/me")).status, 200);
  assert.equal(existsSync(join(evidenceDir, name)), false, "the picture went with the account");
});

test("files saved for a job whose account was deleted while it ran are removed", async () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "smith-"));
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const name = `1-${"cd".repeat(12)}.jpg`;
  const saveImages = async (options, dir) => {
    writeFileSync(join(dir, name), "jpg");
    options[0].image = `/evidence/${name}`;
  };
  const runTask = async (job) => {
    store.deleteUser(job.user_id); // the user deletes their account mid-run
    return { ...RESULT, options: [{ name: "B", price: "", note: "", url: "https://b.example/y" }] };
  };
  const runner = createRunner({ store, runTask, screenshot: async () => false, saveImages, evidenceDir, log: { error() {} } });
  const { job } = await runner.run(store.start("u", store.addQuote(store.user("u").id, "x", QUOTE).id).job);
  assert.equal(job, undefined);
  assert.equal(existsSync(join(evidenceDir, name)), false);
});

test("the app's 'price does not match the page' reason is a price claim; the job view carries codes and coverage", async (t) => {
  const codes = [{ code: "SAVE10", shop: "ร้าน A", note: "ลด 10%", url: "https://a.example/promo" }];
  const coverage = { searches: 2, pages: 2, hosts: ["a.example"], blocked: [] };
  const s = await start({ runTask: async () => ({ ...RESULT, codes, coverage }) });
  t.after(s.close);
  const { body } = await s.call(A, "POST", "/api/quote", { text: "หาของ" });
  await s.call(A, "POST", `/api/jobs/${body.job.id}/start`);
  const job = await waitFor(async () => {
    const r = await s.call(A, "GET", `/api/jobs/${body.job.id}`);
    return r.body.job.status === "done" && r.body.job;
  });
  assert.deepEqual(job.codes, codes);
  assert.deepEqual(job.coverage, coverage);
  const refund = await s.call(A, "POST", `/api/jobs/${body.job.id}/refund`, { reasons: ["ราคาไม่ตรงกับหน้าเว็บ", "ลิงก์เปิดไม่ได้"], note: "ราคาในเว็บ 9,500" });
  assert.equal(refund.body.result, "refunded");
  assert.equal(s.store.job(body.job.id).refund_tag, "price");
  assert.match(s.store.job(body.job.id).refund_reason, /ราคาในเว็บ 9,500/);
});

test("when today's Claude budget is used up, a quote and a start answer 503 and charge nothing", async (t) => {
  const s = await start({ dailyCostCap: 1 });
  t.after(s.close);
  const first = await s.call(A, "POST", "/api/quote", { text: "หาของ" });
  assert.equal(first.status, 200, "under the cap, quotes are made");
  s.store.user("other");
  s.store.addQuote("other", "x", { doable: true, title: "t", steps: [], size: "M", cost: 5 }); // today's spending now passes the cap
  const quote = await s.call(A, "POST", "/api/quote", { text: "อีกงาน" });
  assert.equal(quote.status, 503);
  assert.equal(quote.body.error, "busy");
  const startJob = await s.call(A, "POST", `/api/jobs/${first.body.job.id}/start`);
  assert.equal(startJob.status, 503);
  assert.equal(startJob.body.credit, 20, "nothing was charged");
  assert.equal(s.store.job(first.body.job.id).status, "quoted");
});

test("when the test round is full, a new device is turned away before an account is made", async (t) => {
  const s = await start({ maxUsers: 1 });
  t.after(s.close);
  assert.equal((await s.call(A, "GET", "/api/me")).status, 200);
  const turned = await s.call(B, "GET", "/api/me");
  assert.equal(turned.status, 403);
  assert.equal(turned.body.error, "full");
  assert.equal(s.store.userCount(), 1);
  assert.equal((await s.call(A, "POST", "/api/quote", { text: "หาหูฟัง" })).status, 200, "people already in carry on");
});

test("PromptPay top-up: off unless set; the app shows where to pay; one request waits at a time; the amount is the server's", async (t) => {
  const off = await start();
  t.after(off.close);
  assert.equal((await off.call(A, "POST", "/api/topup", {})).status, 404);
  const s = await start({ topup: { promptpay: "0812345678", name: "สมชาย ใจดี", amount: 50 } });
  t.after(s.close);
  const pay = (await s.call(A, "GET", "/api/me")).body.topup;
  assert.deepEqual({ ...pay, ref: undefined }, { promptpay: "0812345678", name: "สมชาย ใจดี", amount: 50, ref: undefined });
  assert.match(pay.ref, /^SM[0-9A-F]{5}$/, "a transfer-note code so staff can match the bank entry to this account");
  assert.notEqual((await s.call(B, "GET", "/api/me")).body.topup.ref, pay.ref);
  const first = await s.call(A, "POST", "/api/topup", { amount: 5000 });
  assert.equal(first.status, 200);
  assert.equal(first.body.topup.amount, 50, "what the client sends is ignored");
  assert.equal(first.body.topup.status, "pending");
  assert.equal(first.body.credit, 20, "nothing is credited until staff approve");
  assert.equal((await s.call(A, "POST", "/api/topup", {})).body.topup.id, first.body.topup.id, "tapping again returns the waiting request");
  assert.equal((await s.call(A, "GET", "/api/ledger")).body.topups[0].status, "pending");
});

test("from the app, a new top-up and a refund sent to review alert the founder; a repeated tap does not", async (t) => {
  const told = [];
  const alerts = createAlerts({ push: async (to, m) => told.push(m[0].text), adminId: "Uadmin" });
  const s = await start({ topup: { promptpay: "0812345678", name: "", amount: 50 }, alerts });
  t.after(s.close);
  await s.call(A, "POST", "/api/topup", {});
  await s.call(A, "POST", "/api/topup", {});
  assert.equal(told.length, 1);
  assert.match(told[0], /มีคำขอเติมเครดิต ฿50/);
});

test("the service worker is served as JavaScript and is never kept by a cache, so a new version is always picked up", async () => {
  const s = await start();
  const res = await fetch(s.base + "/sw.js");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /javascript/);
  assert.equal(res.headers.get("cache-control"), "no-cache");
  assert.match(await res.text(), /smith-shell-v1/);
  s.close();
});

test("watching a job shows a picture of the page it reads, and taking over stops it at no charge", async (t) => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "smith-"));
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const screenshot = async (url, file, viewport) => {
    assert.equal(viewport?.width, 412, "pictured at phone width");
    if (url.includes("c.example")) return false; // a page that cannot be pictured, such as a bot wall
    writeFileSync(file, "png");
    return true;
  };
  const runTask = (_job, _client, _today, onProgress, signal) =>
    new Promise((_, reject) => {
      onProgress('ค้นหา "x"');
      onProgress("เปิดอ่าน b.example", "https://b.example/p");
      onProgress("เปิดอ่าน c.example", "https://c.example/q");
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const runner = createRunner({ store, runTask, screenshot, evidenceDir, log: { error() {} } });
  const handle = createWeb({ store, quote: async () => QUOTE, runner, evidenceDir, log: { error() {} } });
  const server = createServer(async (req, res) => (await handle(req, res)) || res.writeHead(404).end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path) => fetch(base + path, { method, headers: { Authorization: `Bearer ${A}` } }).then((r) => r.json());

  const { job: quoted } = await call("POST", "/api/quote").catch(() => ({})); // no body: refused
  assert.equal(quoted, undefined);
  const q = await fetch(base + "/api/quote", { method: "POST", headers: { Authorization: `Bearer ${A}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: "x" }) }).then((r) => r.json());
  await call("POST", `/api/jobs/${q.job.id}/start`);
  const live = await waitFor(async () => (await call("GET", `/api/jobs/${q.job.id}`)).job.live?.frame && (await call("GET", `/api/jobs/${q.job.id}`)).job.live);
  assert.equal(live.page, "https://c.example/q");
  assert.equal(live.frame.url, "https://b.example/p", "the picture stays on the last page that could be pictured");
  assert.equal((await fetch(base + live.frame.image)).status, 200, "the picture is served");

  assert.deepEqual(await call("POST", `/api/jobs/${q.job.id}/takeover`), { ok: true, url: "https://b.example/p", credit: 20 }, "the hold comes back, and the page opened is the one in the picture");
  const job = (await call("GET", `/api/jobs/${q.job.id}`)).job;
  assert.equal(job.status, "cancelled");
  assert.equal(job.live, undefined);
  assert.deepEqual(job.sources, [{ title: "b.example", url: "https://b.example/p" }], "the page Smith was on, to open it again");
  assert.ok(!existsSync(join(evidenceDir, basename(live.frame.image))), "live pictures are removed when the job ends");
  assert.equal((await call("POST", `/api/jobs/${q.job.id}/takeover`)).ok, false, "a job that is not running cannot be stopped");
});

test("chat answers on the job, and a search becomes a free follow-up that waits for a tap", async (t) => {
  const asked = [];
  const replies = [
    { kind: "answer", text: "ร้าน B ส่งฟรี", title: "", steps: [], size: "S", cost: 0.1 },
    { kind: "search", text: "จะค้นร้านที่ถูกกว่า", title: "หาถูกกว่า", steps: ["ค้น"], size: "M", cost: 0.1 },
  ];
  const s = await start({ chat: async (job, text) => (asked.push(text), replies.shift()) });
  t.after(s.close);
  const { body } = await s.call(A, "POST", "/api/quote", { text: "หาหูฟัง" });
  const id = body.job.id;
  assert.equal((await s.call(A, "POST", `/api/jobs/${id}/chat`, { text: "x" })).status, 409, "not before the job is done");
  await s.call(A, "POST", `/api/jobs/${id}/start`);
  await waitFor(async () => (await s.call(A, "GET", `/api/jobs/${id}`)).body.job.status === "done");
  const r1 = await s.call(A, "POST", `/api/jobs/${id}/chat`, { text: "ร้านไหนส่งฟรี" });
  assert.deepEqual(r1.body.job.chat.map((m) => [m.role, m.text]), [["user", "ร้านไหนส่งฟรี"], ["smith", "ร้าน B ส่งฟรี"]]);
  const r2 = await s.call(A, "POST", `/api/jobs/${id}/chat`, { text: "หาถูกกว่านี้" });
  const child = r2.body.job.chat.at(-1).child;
  assert.deepEqual([child.status, child.price, child.title], ["quoted", 0, "หาถูกกว่า"], "free, and not started until tapped");
  assert.equal((await s.call(A, "GET", `/api/jobs/${child.id}`)).body.job.parentId, id);
  assert.equal((await s.call(B, "POST", `/api/jobs/${id}/chat`, { text: "x" })).status, 404, "only on your own job");
  assert.equal((await s.call(A, "POST", `/api/jobs/${id}/chat`, { text: "  " })).status, 400);
  assert.equal((await s.call(A, "POST", `/api/jobs/${id}/chat`, { text: "ก".repeat(501) })).status, 400);
  assert.deepEqual(asked, ["ร้านไหนส่งฟรี", "หาถูกกว่านี้"], "refused messages never reach the model");
});

test("chat stops at 10 questions on a job", async (t) => {
  let calls = 0;
  const s = await start({ chat: async () => (calls++, { kind: "answer", text: "ok", title: "", steps: [], size: "S", cost: 0 }) });
  t.after(s.close);
  const { body } = await s.call(A, "POST", "/api/quote", { text: "x" });
  await s.call(A, "POST", `/api/jobs/${body.job.id}/start`);
  await waitFor(async () => (await s.call(A, "GET", `/api/jobs/${body.job.id}`)).body.job.status === "done");
  for (let i = 0; i < 10; i++) assert.equal((await s.call(A, "POST", `/api/jobs/${body.job.id}/chat`, { text: `q${i}` })).status, 200);
  const over = await s.call(A, "POST", `/api/jobs/${body.job.id}/chat`, { text: "q10" });
  assert.deepEqual([over.status, over.body.error, calls], [429, "limit", 10]);
});

test("a follow-up run is given the job it continues", async () => {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  let parent;
  const runTask = async (_job, _c, _t, _p, _s, p) => ((parent = p), RESULT);
  const runner = createRunner({ store, runTask, screenshot: async () => false, log: { error() {} } });
  const u = store.user("u").id;
  const root = store.addQuote(u, "x", QUOTE);
  await runner.run(store.start(u, root.id).job);
  const child = store.addFollowUp(root.id, "x\n\nรอบนี้: y", { title: "y", steps: [], size: "M" });
  await runner.run(store.start(u, child.id).job);
  assert.deepEqual([parent.id, parent.answer], [root.id, RESULT.answer]);
});

test("chat answers one message at a time per job, so parallel requests cannot get past the caps", async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  let calls = 0;
  // A second call that reaches the model opens the gate, so a missing guard fails the test instead of hanging it.
  const s = await start({ chat: async () => (++calls > 1 && release(), await gate, { kind: "answer", text: "ok", title: "", steps: [], size: "S", cost: 0 }) });
  t.after(s.close);
  const { body } = await s.call(A, "POST", "/api/quote", { text: "x" });
  const id = body.job.id;
  await s.call(A, "POST", `/api/jobs/${id}/start`);
  await waitFor(async () => (await s.call(A, "GET", `/api/jobs/${id}`)).body.job.status === "done");
  const first = s.call(A, "POST", `/api/jobs/${id}/chat`, { text: "q1" });
  await waitFor(() => calls === 1);
  const second = await s.call(A, "POST", `/api/jobs/${id}/chat`, { text: "q2" });
  assert.deepEqual([second.status, second.body.error, calls], [409, "chat_busy", 1], "the second is turned away and never reaches the model");
  release();
  assert.equal((await first).status, 200);
  assert.equal((await s.call(A, "POST", `/api/jobs/${id}/chat`, { text: "q3" })).status, 200, "open again once the first answer is in");
});

test("with LINE Login on, signing in with LINE is enough: the invite code is not asked", async (t) => {
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => (url.endsWith("/token") ? { id_token: "idt" } : { sub: "U88", aud: "165" }) });
  const lineLogin = createLineLogin({ channelId: "165", channelSecret: "s", callbackUrl: "https://smith.example/auth/line/callback", fetchImpl });
  const s = await start({ lineLogin, inviteCode: "smith-test" });
  t.after(s.close);
  assert.deepEqual((await s.call(A, "GET", "/api/me")).body, { error: "login" }, "asked to sign in with LINE, not for the invite code");
  const { body } = await s.call(A, "POST", "/api/auth/line");
  const state = new URL(body.url).searchParams.get("state");
  await fetch(`${s.base}/auth/line/callback?code=abc&state=${state}`, { redirect: "manual" });
  assert.equal((await s.call(A, "GET", "/api/me")).body.id, "U88", "a LINE account can use Smith right away");
});

test("a LINE account is one account in the LINE chat and in the app: same jobs, same credit, one chat", async (t) => {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  const runner = createRunner({ store, runTask: async () => RESULT, screenshot: async () => false, log: { error() {} } });
  const chats = createChat({ store, chat: async () => ({ kind: "answer", text: "ร้าน B ส่งฟรี", title: "", steps: [], size: "S", cost: 0 }), full: () => false });
  const sent = [];
  const line = { reply: async (to, messages) => sent.push({ to: "reply", messages }), push: async (to, messages) => sent.push({ to, messages }) };
  const bot = createBot({ store, line, talk: async (past, text) => ({ kind: "task", text: "", task: text, ...QUOTE }), chats, runner, log: { error() {} } });
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => (url.endsWith("/token") ? { id_token: "idt" } : { sub: "U77", aud: "165" }) });
  const lineLogin = createLineLogin({ channelId: "165", channelSecret: "s", callbackUrl: "https://smith.example/auth/line/callback", fetchImpl });
  const handle = createWeb({ store, quote: async () => QUOTE, chats, runner, lineLogin, notify: bot.notify, log: { error() {} } });
  const server = createServer(async (req, res) => (await handle(req, res)) || res.writeHead(404).end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body) => fetch(base + path, { method, headers: { Authorization: `Bearer ${A}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const say = (text) => bot.handle({ type: "message", replyToken: "r", source: { type: "user", userId: "U77" }, message: { type: "text", text } });
  const tap = (data) => bot.handle({ type: "postback", replyToken: "r", source: { type: "user", userId: "U77" }, postback: { data } });

  await say("หาหูฟัง"); // ordered in the LINE chat
  await tap("start:1");
  const { url } = await call("POST", "/api/auth/line"); // then the same person signs in to the app with LINE
  await fetch(`${base}/auth/line/callback?code=abc&state=${new URL(url).searchParams.get("state")}`, { redirect: "manual" });
  const me = await call("GET", "/api/me");
  assert.deepEqual([me.id, me.credit], ["U77", store.user("U77").credit], "the app opens on the LINE account and its credit");
  assert.deepEqual((await call("GET", "/api/jobs")).jobs.map((j) => [j.id, j.status]), [[1, "done"]], "the job ordered in LINE is in the app");
  assert.deepEqual((await call("GET", "/api/talk")).talk.map((e) => [e.role, e.text]).slice(0, 1), [["user", "หาหูฟัง"]], "and so is what they wrote in LINE");
  assert.equal((await call("POST", "/api/jobs/1/chat", { text: "ร้านไหนส่งฟรี" })).job.chat.length, 2, "a question asked in the app");
  await tap("ask:1");
  assert.match(sent.at(-1).messages.at(-1).text, /ถามได้อีก 9 ข้อ/, "counts in the LINE chat too: one chat per job");
});

// ---------- chat before a job
test("the order box answers a question for free, and the chat page shows it", async (t) => {
  const s = await start({ talk: async () => ({ kind: "answer", text: "ผมช่วยค้นและเทียบข้อมูลจากเว็บให้ครับ", cost: 0.01 }) });
  t.after(s.close);
  const r = await s.call(A, "POST", "/api/talk", { text: "ทำไรได้บ้าง" });
  assert.equal(r.status, 200);
  assert.equal(r.body.job, null);
  assert.equal(r.body.credit, 20);
  assert.deepEqual(r.body.talk.map((e) => [e.role, e.text, e.job]), [["user", "ทำไรได้บ้าง", null], ["smith", "ผมช่วยค้นและเทียบข้อมูลจากเว็บให้ครับ", null]]);
  assert.deepEqual((await s.call(A, "GET", "/api/talk")).body.talk.map((e) => e.text), ["ทำไรได้บ้าง", "ผมช่วยค้นและเทียบข้อมูลจากเว็บให้ครับ"]);
  assert.deepEqual((await s.call(B, "GET", "/api/talk")).body.talk, [], "each account sees only its own chat");
});

test("a job from the order box is a quoted job, with its card in the chat", async (t) => {
  const s = await start({ talk: async (past, text) => ({ kind: "task", text: "หาให้ได้ครับ", task: `${text} งบ 3,000`, ...QUOTE }) });
  t.after(s.close);
  const r = await s.call(A, "POST", "/api/talk", { text: "หาหูฟัง" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.job.status, r.body.job.text, r.body.job.price], ["quoted", "หาหูฟัง งบ 3,000", SIZES.M.price]);
  assert.deepEqual(r.body.talk.at(-1).job, { id: r.body.job.id, status: "quoted", price: SIZES.M.price, title: QUOTE.title });
});

test("chat refusals come back as HTTP statuses", async (t) => {
  const s = await start({ talk: async () => ({ kind: "answer", text: "ok", cost: 1 }), quotesPerHour: 1, dailyCostCap: 1 });
  t.after(s.close);
  assert.equal((await s.call(A, "POST", "/api/talk", { text: " " })).status, 400);
  assert.equal((await s.call(A, "POST", "/api/talk", { text: "หวัดดี" })).status, 200, "this answer uses up the day's budget");
  assert.equal((await s.call(A, "POST", "/api/talk", { text: "อีกข้อ" })).status, 429, "one message an hour");
  assert.equal((await s.call(B, "POST", "/api/talk", { text: "หวัดดี" })).status, 503, "the daily cap is shared");
});
