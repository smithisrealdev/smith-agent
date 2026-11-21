import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { reachesPublicHost } from "./evidence.js";

// Product pictures for the option cards: the picture each page names for link previews (og:image).
// The server fetches it, so a user's phone does not contact the shop before they tap the card.
const UA = "Mozilla/5.0 (compatible; SmithAgent/1.0; link preview)";
// The file's own first bytes decide its type; the server's label alone is not trusted.
const kindOf = (b) =>
  b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG" ? "png"
    : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg"
      : b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" ? "webp" : "";

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

// Walks the <meta> tags with indexOf: a regex over the whole page can take seconds on a hostile one
// (thousands of "<meta" with no ">"), and that would stall every request the server is handling.
function* metaTags(html) {
  const lower = html.toLowerCase();
  for (let at = lower.indexOf("<meta"); at >= 0; at = lower.indexOf("<meta", at + 5)) {
    const end = lower.indexOf(">", at);
    if (end < 0) return;
    yield html.slice(at, end + 1);
    at = end - 4;
  }
}

export function ogImage(html, base) {
  for (const tag of metaTags(html)) {
    if (!/image/i.test(tag) || !/\b(?:property|name)\s*=\s*["']?(?:og:image(?::secure_url)?|twitter:image)["'\s>]/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    try {
      return new URL((content[1] ?? content[2]).replaceAll("&amp;", "&"), base).href;
    } catch {
      // no usable address in this tag: try the next one
    }
  }
  return "";
}

// Saves the page's preview picture as <dir>/<name>.jpg and returns the file name, or "" when there is none.
// Every picture is re-encoded as a JPEG of at most 800x800: small on mobile data, within LINE's 1024px limit,
// and a format LINE can show (it cannot show WebP). Decoding it also proves the file is a real picture.
async function productImage(pageUrl, dir, name, deps) {
  const page = await publicFetch(pageUrl, deps);
  if (!page || !/html/i.test(page.res.headers.get("content-type") || "")) return "";
  const src = ogImage((await readBody(page.res, 512_000, true)).toString("utf8"), page.url);
  const img = src && (await publicFetch(src, deps));
  const data = img && /^image\//i.test(img.res.headers.get("content-type") || "") && (await readBody(img.res, 1_500_000));
  if (!data || !kindOf(data)) return "";
  const jpeg = await sharp(data, { limitInputPixels: 25_000_000 }) // refuses decompression bombs
    .rotate() // apply the camera's orientation before it is dropped
    .resize(800, 800, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#FFFFFF" }) // transparent PNGs get a white background, not black
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.jpg`), jpeg);
  return `${name}.jpg`;
}

// Gives each option whose page has a preview picture an `image` the app can load. Never throws.
export async function saveImages(options, dir, jobId, deps) {
  await Promise.all(options.map(async (o) => {
    const file = o.url && (await productImage(o.url, dir, `${jobId}-${randomBytes(12).toString("hex")}`, deps).catch(() => ""));
    if (file) o.image = `/evidence/${file}`; // unguessable name, like the screenshot
  }));
}
