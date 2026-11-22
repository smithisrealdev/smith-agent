import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign as rsaSign, verify as verifySig } from "node:crypto";
import { createAppleLogin } from "../src/apple.js";

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "K1", alg: "RS256", use: "sig" };
const NOW = 1_800_000_000_000;
const sign = (claims, { kid = "K1", key = privateKey } = {}) => {
  const head = `${b64({ alg: "RS256", kid })}.${b64(claims)}`;
  return `${head}.${rsaSign("RSA-SHA256", Buffer.from(head), key).toString("base64url")}`;
};
const raw = "raw-nonce-123";
const good = { iss: "https://appleid.apple.com", aud: "com.smithagent.app", sub: "001234.abc", exp: NOW / 1000 + 600, nonce: createHash("sha256").update(raw).digest("hex") };

function setup({ withKey = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body && Object.fromEntries(new URLSearchParams(init.body)) });
    if (url.endsWith("/auth/keys")) return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
    if (url.endsWith("/auth/token")) return { ok: true, status: 200, json: async () => ({ refresh_token: "rt-1" }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const key = withKey ? { teamId: "TEAM1", keyId: "KEY1", privateKey: ec.privateKey.export({ format: "pem", type: "pkcs8" }) } : {};
  return { calls, ec, apple: createAppleLogin({ bundleId: "com.smithagent.app", fetchImpl, now: () => NOW, ...key }) };
}

test("an Apple identity token signed by Apple's key, for our app, with our nonce, gives an apple: user", async () => {
  const { apple, calls } = setup();
  assert.equal(await apple.verify(sign(good), raw), "apple:001234.abc");
  assert.equal(await apple.verify(sign(good), raw), "apple:001234.abc");
  assert.equal(calls.filter((c) => c.url.endsWith("/auth/keys")).length, 1, "Apple's keys are fetched once and kept");
});

test("forged, foreign, expired or replayed-nonce tokens are refused", async () => {
  const { apple } = setup();
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  await assert.rejects(apple.verify(sign(good, { key: other }), raw), /signature/);
  await assert.rejects(apple.verify(sign({ ...good, aud: "com.other.app" }), raw), /audience/);
  await assert.rejects(apple.verify(sign({ ...good, iss: "https://evil.example" }), raw), /issuer/);
  await assert.rejects(apple.verify(sign({ ...good, exp: NOW / 1000 - 1 }), raw), /expired/);
  await assert.rejects(apple.verify(sign(good), "another-nonce"), /nonce/);
  await assert.rejects(apple.verify(sign(good, { kid: "nope" }), raw), /key/);
  await assert.rejects(apple.verify("not.a.jwt", raw), /token/);
});

test("with an Apple key, the sign-in code becomes a refresh token, and deleting the account revokes it", async () => {
  const { apple, calls, ec } = setup({ withKey: true });
  assert.equal(await apple.refreshToken("auth-code"), "rt-1");
  const tokenCall = calls.find((c) => c.url === "https://appleid.apple.com/auth/token");
  assert.equal(tokenCall.body.code, "auth-code");
  assert.equal(tokenCall.body.client_id, "com.smithagent.app");
  const [h, p, s] = tokenCall.body.client_secret.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "KEY1" });
  assert.equal(JSON.parse(Buffer.from(p, "base64url")).iss, "TEAM1");
  assert.ok(verifySig("sha256", Buffer.from(`${h}.${p}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")), "client secret signed with the Apple key");
  await apple.revoke("rt-1");
  const revoke = calls.find((c) => c.url === "https://appleid.apple.com/auth/revoke");
  assert.equal(revoke.body.token, "rt-1");
  assert.equal(revoke.body.token_type_hint, "refresh_token");
});

test("without an Apple key there is nothing to exchange or revoke", async () => {
  const { apple, calls } = setup();
  assert.equal(await apple.refreshToken("auth-code"), null);
  await apple.revoke("rt");
  assert.equal(calls.length, 0);
});
