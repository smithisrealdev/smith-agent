import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logoHost, saveLogos } from "../src/logo.js";

test("only plain host names become logo files", () => {
  assert.equal(logoHost("https://www.Shop-B.example/p/1?x=2"), "shop-b.example");
  for (const bad of ["javascript:alert(1)", "https://localhost/x", "https://[::1]/", "not a url", ""]) assert.equal(logoHost(bad), "", bad);
});

test("each site's logo is fetched once, and a failed or odd answer just leaves no file", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "smith-")), "logos");
  const asked = [];
  const png = (type = "image/png", ok = true) => ({ ok, headers: new Headers({ "content-type": type }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  const fetchImpl = async (url) => {
    asked.push(new URL(url).searchParams.get("domain"));
    if (url.endsWith("down.example")) throw new Error("timeout");
    if (url.endsWith("unknown.example")) return png("image/png", false);
    if (url.endsWith("html.example")) return png("text/html");
    return png();
  };
  const urls = ["https://www.a.example/1", "https://a.example/2", "https://down.example", "https://unknown.example", "https://html.example", "nope"];
  await saveLogos(urls, dir, fetchImpl);
  assert.deepEqual(readdirSync(dir), ["a.example.png"]);
  assert.deepEqual(asked.sort(), ["a.example", "down.example", "html.example", "unknown.example"], "one request per site");
  await saveLogos(["https://a.example/3"], dir, fetchImpl);
  assert.equal(asked.length, 4, "a saved logo is not fetched again");
});
