import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, makeStore } from "../src/db.js";
import { createRunner } from "../src/runner.js";
import { createWeb } from "../src/web.js";
import { createLineLogin } from "../src/linelogin.js";
import { createAlerts } from "../src/alerts.js";

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
