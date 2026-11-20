import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignature, lineClient, text, postback } from "../src/line.js";
import { isPublicUrl } from "../src/evidence.js";

test("webhook signatures: only the channel secret's HMAC passes", () => {
  const body = Buffer.from('{"events":[]}');
  const sig = createHmac("sha256", "secret").update(body).digest("base64");
  assert.equal(verifySignature("secret", body, sig), true);
  assert.equal(verifySignature("other", body, sig), false);
  assert.equal(verifySignature("secret", Buffer.from('{"events":[1]}'), sig), false);
  assert.equal(verifySignature("secret", body, undefined), false);
  assert.equal(verifySignature("", body, sig), false);
  assert.equal(verifySignature("secret", body, "short"), false);
});

test("messages respect LINE limits", () => {
  assert.equal(text("x".repeat(6000)).text.length, 5000);
  assert.equal(text("hi").quickReply, undefined);
  const m = text("hi", [postback("เริ่มงานยาวมากเกินยี่สิบตัวอักษร", "start:1")]);
  assert.equal(m.quickReply.items[0].action.label.length, 20);
  assert.equal(m.quickReply.items[0].action.data, "start:1");
});

test("the LINE client posts with the token and surfaces errors", async () => {
  const seen = [];
  const ok = lineClient("tok", async (url, init) => { seen.push({ url, init }); return { ok: true }; });
  await ok.push("u1", [text("hi")]);
  assert.equal(seen[0].url, "https://api.line.me/v2/bot/message/push");
  assert.equal(seen[0].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(seen[0].init.body), { to: "u1", messages: [{ type: "text", text: "hi" }] });
  const bad = lineClient("tok", async () => ({ ok: false, status: 400, text: async () => "bad token" }));
  await assert.rejects(bad.reply("r", []), /LINE reply 400: bad token/);
});

test("evidence screenshots only reach public hosts", () => {
  for (const u of ["https://www.airasia.com/th", "http://shop.example.co.th/item?id=1"]) assert.equal(isPublicUrl(u), true, u);
  for (const u of [
    "http://localhost:3000", "http://127.0.0.1/", "http://10.0.0.5", "http://169.254.169.254/latest/meta-data",
    "http://[::1]/", "http://metadata.google.internal/", "https://printer.local/", "http://intranet/", "file:///etc/passwd",
    "javascript:alert(1)", "not a url",
  ]) assert.equal(isPublicUrl(u), false, u);
});
