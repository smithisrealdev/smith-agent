import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { reachesPublicHost } from "./evidence.js";

// Product pictures for the option cards: the picture each page names for link previews (og:image).
// The server fetches it, so a user's phone does not contact the shop before they tap the card.
const UA = "Mozilla/5.0 (compatible; SmithAgent/1.0; link preview)";
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// A fetch that only talks to public hosts, checked again at every redirect.
// shortcut: same DNS-rebinding gap as the screenshot (see evidence.js), same upgrade.
async function publicFetch(url, { fetchImpl = fetch, resolve } = {}) {
  for (let hop = 0; hop < 4; hop++) {
    if (!(await reachesPublicHost(url, resolve))) return null;
    const res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(4000), headers: { "User-Agent": UA, Accept: "text/html,image/*" } });
    if (res.status < 300 || res.status > 399) return res.ok ? { res, url } : null;
    const next = res.headers.get("location");
    if (!next) return null;
    url = new URL(next, url).href;
  }
  return null;
}

// At most `max` bytes of a response. A longer one is cut when `cut` is set (a page's head is enough), else refused.
async function readBody(res, max, cut = false) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max && !cut) return null;
    chunks.push(chunk);
    if (size > max) break;
  }
  return Buffer.concat(chunks);
}

export function ogImage(html, base) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/\b(?:property|name)\s*=\s*["']?(?:og:image(?::secure_url)?|twitter:image)["'\s>]/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    try {
      return new URL((content[1] ?? content[2]).replaceAll("&amp;", "&"), base).href;
    } catch {
      // no usable address in this tag: try the next one
    }
  }
  return "";
}

// Saves the page's preview picture as <dir>/<name>.<ext> and returns the file name, or "" when there is none.
// shortcut: kept at its original size (up to 1.5 MB) though shown small; resize when mobile data matters.
async function productImage(pageUrl, dir, name, deps) {
  const page = await publicFetch(pageUrl, deps);
  if (!page || !/html/i.test(page.res.headers.get("content-type") || "")) return "";
  const src = ogImage((await readBody(page.res, 512_000, true)).toString("utf8"), page.url);
  const img = src && (await publicFetch(src, deps));
  const ext = img && EXT[(img.res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()];
  const data = ext && (await readBody(img.res, 1_500_000));
  if (!data?.length) return "";
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.${ext}`), data);
  return `${name}.${ext}`;
}

// Gives each option whose page has a preview picture an `image` the app can load. Never throws.
export async function saveImages(options, dir, jobId, deps) {
  await Promise.all(options.map(async (o) => {
    const file = o.url && (await productImage(o.url, dir, `${jobId}-${randomBytes(12).toString("hex")}`, deps).catch(() => ""));
    if (file) o.image = `/evidence/${file}`; // unguessable name, like the screenshot
  }));
}
