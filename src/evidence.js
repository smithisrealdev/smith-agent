import { createRequire } from "node:module";

// The model picks the page to screenshot, so only let the browser reach public hosts.
// shortcut: hostname checks only (no DNS resolution, so DNS rebinding can still reach a private IP);
// upgrade by resolving each host and rejecting private ranges, or by running the browser in a network sandbox.
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

// Screenshot one page as evidence. Playwright is optional: without it the result goes out with links only.
export async function screenshot(url, file) {
  if (!isPublicUrl(url)) return false;
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    return false;
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, locale: "th-TH" });
    await page.route("**/*", (route) => (isPublicUrl(route.request().url()) ? route.continue() : route.abort()));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: file });
    return true;
  } catch (err) {
    console.warn("screenshot failed", url, err.message);
    return false;
  } finally {
    await browser.close();
  }
}
