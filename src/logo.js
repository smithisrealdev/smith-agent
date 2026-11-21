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

async function saveLogo(host, dir, fetchImpl) {
  const file = join(dir, `${host}.png`);
  if (await access(file).then(() => true, () => false)) return;
  const res = await fetchImpl(ICON_SERVICE + host, { signal: AbortSignal.timeout(3000) });
  if (!res.ok || !/^image\/(png|jpeg|x-icon|vnd\.microsoft\.icon)/.test(res.headers.get("content-type") || "")) return; // unknown site: the app shows its globe
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > 200_000) return;
  await mkdir(dir, { recursive: true });
  await writeFile(file, data);
}

// Never throws: a missing logo only means the app shows its own icon.
export async function saveLogos(urls, dir, fetchImpl = fetch) {
  const hosts = [...new Set(urls.map(logoHost).filter(Boolean))];
  await Promise.allSettled(hosts.map((host) => saveLogo(host, dir, fetchImpl)));
}
