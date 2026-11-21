import { test } from "node:test";
import assert from "node:assert/strict";
import { createLineLogin } from "../src/linelogin.js";

// A stand-in for LINE's token and verify endpoints that records what it was sent.
function fakeLine({ tokenOk = true, claims = { sub: "U1234", aud: "1650000000" } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body)) });
    if (url.endsWith("/token")) return { ok: tokenOk, status: tokenOk ? 200 : 400, json: async () => ({ access_token: "at", id_token: "idt" }) };
    return { ok: true, status: 200, json: async () => claims };
  };
  return { calls, fetchImpl };
}
const setup = (opts) => {
  let t = 1_000_000;
  const line = fakeLine(opts);
  const login = createLineLogin({ channelId: "1650000000", channelSecret: "sec", callbackUrl: "https://smith.example/auth/line/callback", fetchImpl: line.fetchImpl, now: () => t });
  return { login, line, later: (ms) => (t += ms) };
};

test("the authorize URL asks LINE for an ID token, with state, nonce and the bot friend prompt", () => {
  const { login } = setup();
  const u = new URL(login.start("phone-key"));
  assert.equal(u.origin + u.pathname, "https://access.line.me/oauth2/v2.1/authorize");
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.response_type, "code");
  assert.equal(q.client_id, "1650000000");
  assert.equal(q.redirect_uri, "https://smith.example/auth/line/callback");
  assert.equal(q.scope, "profile openid");
  assert.equal(q.bot_prompt, "aggressive");
  assert.match(q.state, /^[0-9a-f]{48}$/);
  assert.match(q.nonce, /^[0-9a-f]{32}$/);
});

test("finishing exchanges the code, has LINE verify the ID token with our nonce, and returns the LINE user", async () => {
  const { login, line } = setup();
  const q = new URL(login.start("phone-key")).searchParams;
  const r = await login.finish(q.get("state"), "the-code");
  assert.deepEqual(r, { key: "phone-key", userId: "U1234" });
  assert.equal(line.calls[0].url, "https://api.line.me/oauth2/v2.1/token");
  assert.deepEqual(line.calls[0].body, { grant_type: "authorization_code", code: "the-code", redirect_uri: "https://smith.example/auth/line/callback", client_id: "1650000000", client_secret: "sec" });
  assert.equal(line.calls[1].url, "https://api.line.me/oauth2/v2.1/verify");
  assert.deepEqual(line.calls[1].body, { id_token: "idt", client_id: "1650000000", nonce: q.get("nonce") });
});

test("a state works once, expires after 10 minutes, and must be one we issued", async () => {
  const { login, later } = setup();
  const state = new URL(login.start("k")).searchParams.get("state");
  await login.finish(state, "c");
  await assert.rejects(login.finish(state, "c"), /state/, "replayed");
  await assert.rejects(login.finish("made-up", "c"), /state/);
  const old = new URL(login.start("k")).searchParams.get("state");
  later(10 * 60e3 + 1);
  await assert.rejects(login.finish(old, "c"), /state/, "expired");
});

test("LINE errors and tokens for another channel are refused", async () => {
  const bad = setup({ tokenOk: false });
  await assert.rejects(bad.login.finish(new URL(bad.login.start("k")).searchParams.get("state"), "c"), /LINE token 400/);
  const other = setup({ claims: { sub: "U9", aud: "999" } });
  await assert.rejects(other.login.finish(new URL(other.login.start("k")).searchParams.get("state"), "c"), /not for this channel/);
});
