import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignature, lineClient, text, postback } from "../src/line.js";
import { isPublicUrl, isPrivateIp, reachesPublicHost } from "../src/evidence.js";

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

test("private, loopback, link-local and reserved addresses are recognised", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "0.0.0.0", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "100.64.0.1", "100.127.255.254", "192.0.0.8", "192.0.2.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "64:ff9b::a00:1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "192.0.32.10", "203.0.113.5", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("a public name that resolves to a private address is refused", async () => {
  const dns = (map) => async (host) => {
    if (!(host in map)) throw new Error("ENOTFOUND");
    return map[host].map((address) => ({ address }));
  };
  const resolve = dns({ "shop.example.com": ["93.184.216.34"], "evil.example.com": ["169.254.169.254"], "mixed.example.com": ["93.184.216.34", "10.0.0.1"] });
  assert.equal(await reachesPublicHost("https://shop.example.com/p", resolve), true);
  assert.equal(await reachesPublicHost("https://evil.example.com/", resolve), false);
  assert.equal(await reachesPublicHost("https://mixed.example.com/", resolve), false, "any private answer is enough to refuse");
  assert.equal(await reachesPublicHost("https://gone.example.com/", resolve), false, "a failed lookup is refused");
  assert.equal(await reachesPublicHost("http://localhost/", resolve), false, "the URL check still runs first");
});
