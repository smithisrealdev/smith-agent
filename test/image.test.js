import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { ogImage, saveImages } from "../src/image.js";

test("the preview picture is read from a page's meta tags, whatever their order or quoting", () => {
  const base = "https://shop.example/p/1";
  assert.equal(ogImage(`<meta property="og:image" content="https://cdn.example/a.jpg?w=1&amp;h=2">`, base), "https://cdn.example/a.jpg?w=1&h=2");
  assert.equal(ogImage(`<meta content='/img/b.png' property='og:image'>`, base), "https://shop.example/img/b.png");
  assert.equal(ogImage(`<meta name="twitter:image" content="https://cdn.example/c.webp">`, base), "https://cdn.example/c.webp");
  assert.equal(ogImage(`<meta property="og:image:width" content="1200"><meta property="og:title" content="x">`, base), "");
});

test("options get a picture only from public pages, with every redirect checked, and only real, small images", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smith-"));
  const html = (img) => new Response(`<html><head><meta property="og:image" content="${img}"></head>`, { headers: { "content-type": "text/html; charset=utf-8" } });
  const WEBP = await sharp({ create: { width: 1200, height: 630, channels: 4, background: "#E33" } }).webp().toBuffer(); // a typical wide preview, in a format LINE cannot show
  const image = (type, bytes = WEBP) => new Response(new Uint8Array(bytes), { headers: { "content-type": type } });
  const to = (location) => new Response(null, { status: 302, headers: { location } });
  const pages = {
    "https://shop.example/ok": () => to("https://www.shop.example/ok"),
    "https://www.shop.example/ok": () => html("https://cdn.example/ok.jpg"),
    "https://cdn.example/ok.jpg": () => image("image/webp"),
    "https://shop.example/broken": () => html("https://cdn.example/broken.jpg"),
    "https://cdn.example/broken.jpg": () => image("image/jpeg", [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
    "https://shop.example/inward": () => html("https://cdn.example/inward.png"),
    "https://cdn.example/inward.png": () => to("https://intranet.example/secret.png"),
    "https://shop.example/svg": () => html("https://cdn.example/x.svg"),
    "https://cdn.example/x.svg": () => image("image/svg+xml", [...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]),
    "https://shop.example/huge": () => html("https://cdn.example/huge.png"),
    "https://cdn.example/huge.png": () => image("image/png", new Uint8Array(1_600_000).fill(0xff)),
    "https://shop.example/fake": () => html("https://cdn.example/fake.png"),
    "https://cdn.example/fake.png": () => image("image/png", [...Buffer.from("<html><script>alert(1)</script>")]),
    "https://shop.example/none": () => new Response("<html>no tags</html>", { headers: { "content-type": "text/html" } }),
    "https://shop.example/gone": () => new Response("", { status: 404 }),
  };
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push(url);
    assert.equal(init.redirect, "manual", "redirects are followed by hand so each hop is checked");
    return pages[url]();
  };
  const resolve = async (host) => [{ address: host === "intranet.example" ? "10.0.0.5" : "203.0.113.9" }];
  const options = ["ok", "inward", "svg", "huge", "fake", "broken", "none", "gone"].map((k) => ({ name: k, url: `https://shop.example/${k}` }));
  options.push({ name: "private", url: "https://intranet.example/p" }, { name: "no link", url: "" });
  await saveImages(options, dir, 7, { fetchImpl, resolve });
  const got = Object.fromEntries(options.map((o) => [o.name, o.image]));
  assert.match(got.ok, /^\/evidence\/7-[0-9a-f]{24}\.jpg$/);
  const saved = await sharp(readFileSync(join(dir, got.ok.split("/").pop()))).metadata();
  assert.deepEqual([saved.format, saved.width, saved.height], ["jpeg", 800, 420], "re-encoded as a JPEG that fits in 800x800");
  assert.deepEqual(readdirSync(dir).length, 1, "nothing else was saved");
  for (const k of ["inward", "svg", "huge", "fake", "broken", "none", "gone", "private", "no link"]) assert.equal(got[k], undefined, k);
  assert.ok(!asked.some((u) => u.includes("intranet.example")), "a private address is never contacted");
});

test("a hostile page with thousands of unclosed meta tags is read in linear time", () => {
  const started = performance.now();
  assert.equal(ogImage("<meta ".repeat(90_000), "https://x.example/"), "");
  assert.equal(ogImage(`${"<meta x>".repeat(60_000)}<meta property="og:image" content="/a.png">`, "https://x.example/"), "https://x.example/a.png");
  assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`);
});
