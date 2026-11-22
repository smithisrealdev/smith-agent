import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Load public/sw.js the way a browser would: with `self`, `caches` and `fetch` of its own, here small fakes.
function load() {
  const listeners = {};
  const stores = new Map();
  const key = (req) => (typeof req === "string" ? req : req.url);
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (req, res) => void m.set(key(req), res),
      match: async (req, opt = {}) => m.get(key(req)) || (opt.ignoreSearch ? m.get(key(req).split("?")[0]) : undefined),
      addAll: async (urls) => urls.forEach((u) => m.set("https://app.test" + u, new Response("shell"))),
    };
  };
  const state = { online: true, status: 200, calls: [] };
  const ctx = {
    self: { location: { origin: "https://app.test" }, addEventListener: (t, f) => (listeners[t] = f), skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { open, keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n) },
    fetch: async (req) => {
      state.calls.push(key(req));
      if (!state.online) throw new TypeError("offline");
      return new Response(JSON.stringify({ at: state.calls.length }), { status: state.status, headers: { "Content-Type": "application/json" } });
    },
    Response, Headers, URL, AbortController, setTimeout, clearTimeout, Promise, Map,
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), ctx);
  const ask = async (url, method = "GET") => {
    let answer;
    const handled = { v: false };
    await listeners.fetch({ request: { url, method }, respondWith: (p) => ((handled.v = true), (answer = p)) });
    return handled.v ? await answer : undefined;
  };
  return { ask, state, stores, listeners };
}

test("the app's own files are saved on install, and only the files the app is made of", async () => {
  const sw = load();
  let work;
  sw.listeners.install({ waitUntil: (p) => (work = p) });
  await work;
  assert.ok(sw.stores.get("smith-shell-v1").has("https://app.test/app.js"));
  assert.ok(sw.stores.get("smith-shell-v1").has("https://app.test/"));
  assert.equal(await sw.ask("https://app.test/sw.js"), undefined, "the worker itself is never served from its own cache");
  assert.equal(await sw.ask("https://app.test/healthz"), undefined);
});

test("a job list is read from the network, and from the saved copy only when the network fails, marked as saved", async () => {
  const sw = load();
  const live = await sw.ask("https://app.test/api/jobs");
  assert.equal(live.headers.get("X-Smith-Offline"), null);
  sw.state.online = false;
  const saved = await sw.ask("https://app.test/api/jobs");
  assert.equal(saved.headers.get("X-Smith-Offline"), "1");
  assert.deepEqual(await saved.json(), { at: 1 }, "what was answered the first time");
  assert.equal(await sw.ask("https://app.test/api/jobs/7").then((r) => r).catch((e) => e.message), "offline", "never opened: nothing to show, so the app sees the failure");
});

test("an error answer is passed on, not saved, and not used later in place of a good one", async () => {
  const sw = load();
  sw.state.status = 401;
  const res = await sw.ask("https://app.test/api/me");
  assert.equal(res.status, 401);
  assert.equal(sw.stores.get("smith-data-v1").size, 0);
  sw.state.online = false;
  await assert.rejects(sw.ask("https://app.test/api/me"), /offline/, "a 401 was never saved to fall back on");
});

test("only the reading screens' API is saved; actions and other routes are left alone", async () => {
  const sw = load();
  for (const [url, method] of [["https://app.test/api/jobs", "POST"], ["https://app.test/api/jobs/3/start", "POST"], ["https://app.test/api/quote", "POST"],
    ["https://app.test/api/me", "DELETE"], ["https://app.test/api/topup", "GET"], ["https://app.test/api/admin/backup", "GET"], ["https://other.test/api/jobs", "GET"]]) {
    assert.equal(await sw.ask(url, method), undefined, `${method} ${url}`);
  }
  for (const u of ["me", "jobs", "jobs/12", "ledger"]) assert.ok(await sw.ask("https://app.test/api/" + u), u);
});

test("pictures are kept in the user's data cache, fonts in their own, and a page with a query is still the app", async () => {
  const sw = load();
  await sw.ask("https://app.test/evidence/5-" + "a".repeat(24) + ".png");
  assert.equal(sw.stores.get("smith-data-v1").size, 1);
  await sw.ask("https://fonts.gstatic.com/s/mitr/x.woff2");
  assert.equal(sw.stores.get("smith-fonts-v1").size, 1);
  assert.equal(await sw.ask("https://evil.test/x.js"), undefined);
  let work;
  sw.listeners.install({ waitUntil: (p) => (work = p) });
  await work;
  sw.state.online = false;
  assert.equal(await (await sw.ask("https://app.test/?from=line")).text(), "shell");
});

test("an old cache of the app's own is removed when a new version starts, and other sites' caches are not touched", async () => {
  const sw = load();
  for (const n of ["smith-shell-v0", "smith-shell-v1", "other-app"]) sw.stores.set(n, new Map());
  let work;
  sw.listeners.activate({ waitUntil: (p) => (work = p) });
  await work;
  assert.deepEqual([...sw.stores.keys()].sort(), ["other-app", "smith-shell-v1"]);
});
