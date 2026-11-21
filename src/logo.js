import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Result cards show each site's own logo. The server fetches it once per site when a job finishes,
// so a user's phone never talks to the icon service, and the service sees site names only.
const ICON_SERVICE = "https://www.google.com/s2/favicons?sz=64&domain=";

export const logoHost = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : ""; // also the only shape /logo/ serves
  } catch {
    return "";
  }
};

// True when the logo is on disk, already or now.
async function saveLogo(host, dir, fetchImpl) {
  const file = join(dir, `${host}.png`);
  if (await access(file).then(() => true, () => false)) return true;
  const res = await fetchImpl(ICON_SERVICE + host, { signal: AbortSignal.timeout(3000) });
  // PNG or JPEG only (LINE shows nothing else). An unknown site gets no file: the app shows its globe.
  if (!res.ok || !/^image\/(png|jpeg)/.test(res.headers.get("content-type") || "")) return false;
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > 200_000) return false;
  await mkdir(dir, { recursive: true });
  await writeFile(file, data);
  return true;
}

// Returns the sites that now have a logo. Never throws: a missing logo only means the app shows its own icon.
export async function saveLogos(urls, dir, fetchImpl = fetch) {
  const hosts = [...new Set(urls.map(logoHost).filter(Boolean))];
  const saved = await Promise.all(hosts.map((host) => saveLogo(host, dir, fetchImpl).catch(() => false)));
  return hosts.filter((_, i) => saved[i]);
}
