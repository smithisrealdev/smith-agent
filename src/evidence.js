import { createRequire } from "node:module";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// The model picks the page to screenshot, so the browser may only reach public hosts.
// First a cheap check on the URL itself.
export function isPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host.startsWith("[")) return false; // single-label names and IPv6 literals
  if (/^\d+(\.\d+){3}$/.test(host)) return false; // IPv4 literals
  return !/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host);
}

// Loopback, private, link-local, carrier NAT, benchmark, multicast and reserved addresses.
export function isPrivateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateIp(mapped[1]);
  return v6 === "::" || v6 === "::1" || /^(f[cd]|fe[89ab]|ff|64:ff9b:)/.test(v6); // unique local, link-local, multicast, NAT64
}

// Then resolve the host: a public name can still point at a private address.
export async function reachesPublicHost(raw, resolve = lookup) {
  if (!isPublicUrl(raw)) return false;
  try {
    const addresses = await resolve(new URL(raw).hostname, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

// Screenshot one page as evidence. Playwright is optional: without it the result goes out with links only.
// shortcut: Chromium resolves each host again after our check, so a DNS answer that flips in between (rebinding)
// can still slip through; upgrade by running the browser behind an egress proxy that blocks private ranges.
export async function screenshot(url, file) {
  if (!(await reachesPublicHost(url))) return false;
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    return false;
  }
  const allowed = new Map(); // "https://host" -> Promise<boolean>, one lookup per origin for the page's sub-requests
  const check = (requestUrl) => {
    let key;
    try {
      const u = new URL(requestUrl);
      key = `${u.protocol}//${u.host}`;
    } catch {
      return Promise.resolve(false);
    }
    if (!allowed.has(key)) allowed.set(key, reachesPublicHost(requestUrl));
    return allowed.get(key);
  };
  let browser;
  try {
    browser = await chromium.launch(); // throws when the Chromium binary is not installed
    const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, locale: "th-TH" });
    await page.route("**/*", async (route) => ((await check(route.request().url())) ? route.continue() : route.abort()));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: file });
    return true;
  } catch (err) {
    console.warn("screenshot failed", url, err.message);
    return false;
  } finally {
    await browser?.close();
  }
}
