// `node src/cli.js doctor`: is this server set up for an invite-only test? One line per check, worst first.
// The checks are plain functions of the settings plus a few probes (Claude, LINE, Playwright, the disk), so the
// list can be tested without the network.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const LEVEL = { bad: 0, warn: 1, ok: 2 };
const MARK = { bad: "✗", warn: "!", ok: "✓" };

export async function checkSetup(env, config, sizes, probe) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const onRender = Boolean(env.RENDER);

  // Claude: the one thing every job needs.
  if (!env.ANTHROPIC_API_KEY && !config.openrouterKey) add("bad", "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY หรือ OPENROUTER_API_KEY ใบเสนอราคาและงานทุกงานจะล้มเหลว");
  else {
    const via = config.openrouterKey ? "ผ่าน OpenRouter" : "ตรงจาก Anthropic";
    const r = await probe.claude();
    add(r.ok ? "ok" : "bad", r.ok ? `Claude ใช้ได้ ${via} (รุ่น ${config.model})${r.left !== undefined ? ` · เครดิต OpenRouter เหลือ $${r.left.toFixed(2)}` : ""}` : `เรียก Claude ${via} ไม่ได้: ${r.error}`);
    if (r.left !== undefined && r.left < 5) add("warn", `เครดิต OpenRouter เหลือน้อย ($${r.left.toFixed(2)}) เติมก่อนหมด ไม่งั้นงานทุกงานจะล้มเหลว`);
  }

  // Data: on Render only the disk survives a restart or a deploy.
  if (onRender && !config.dbPath.startsWith("/data")) add("bad", `ฐานข้อมูลอยู่ที่ ${config.dbPath} ไม่ใช่ดิสก์ /data ของ Render ข้อมูลจะหายเมื่อ deploy ใหม่`);
  else add(probe.writable() ? "ok" : "bad", probe.writable() ? `ฐานข้อมูล ${config.dbPath} เขียนได้` : `เขียนฐานข้อมูลที่ ${config.dbPath} ไม่ได้`);
  const age = probe.backupAgeHours();
  if (age === null) add("warn", "ยังไม่มีสำเนาฐานข้อมูล (เซิร์ฟเวอร์ทำให้วันละครั้ง หรือรัน node src/cli.js backup)");
  else add(age <= 26 ? "ok" : "warn", `สำเนาฐานข้อมูลล่าสุด ${Math.round(age)} ชั่วโมงก่อน`);
  if (!config.adminToken) add("warn", "ยังไม่ได้ตั้ง ADMIN_TOKEN จึงดาวน์โหลดสำเนาออกนอกเซิร์ฟเวอร์ไม่ได้ (ดู README)");

  // Money and who gets in.
  const trial = 3 * sizes.M.price;
  if (config.startCredit > trial) add("warn", `เครดิตเริ่มต้น ฿${config.startCredit} มากกว่า 3 งานกลาง (฿${trial}) ตาม founder/pricing.md ลบ START_CREDIT ใน Environment ถ้าไม่ได้ตั้งใจ`);
  else add("ok", `เครดิตเริ่มต้น ฿${config.startCredit}`);
  if (!config.inviteCode && !probe.lineLogin) add("bad", "ไม่มี WEB_INVITE_CODE และไม่ได้เปิดเข้าสู่ระบบด้วย LINE ใครเปิดลิงก์ก็ใช้เครดิต Claude ของคุณได้");
  if (!config.maxUsers) add("warn", "ไม่ได้ตั้ง MAX_USERS รหัสเชิญใช้ร่วมกันได้ไม่จำกัดคน");
  else add("ok", `รับผู้ทดลองไม่เกิน ${config.maxUsers} บัญชี`);
  if (!probe.lineLogin) add("warn", "ยังไม่ได้เปิดเข้าสู่ระบบด้วย LINE ทุกเบราว์เซอร์นับเป็นหนึ่งบัญชีและได้เครดิตเริ่มต้นใหม่");
  if (!config.dailyCostCap) add("warn", "ปิดเพดานต้นทุนต่อวันอยู่ (DAILY_COST_CAP=0)");
  else add("ok", `เพดานต้นทุน Claude ต่อวัน ฿${config.dailyCostCap}`);
  if (config.topup) add("ok", `เปิดเติมเครดิตผ่าน PromptPay ${config.topup.promptpay} ครั้งละ ฿${config.topup.amount} (ถามนักบัญชีเรื่องภาษีแล้วหรือยัง)`);
  else add("ok", "ยังไม่เปิดเติมเครดิตผ่าน PromptPay (ตั้ง TOPUP_PROMPTPAY เมื่อพร้อม)");

  // LINE: the bot, its monthly push quota, and where pictures come from.
  if (!config.lineToken || !config.lineSecret) add("warn", "ยังไม่ได้เปิดบอท LINE (LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN)");
  else {
    const r = await probe.line();
    if (!r.ok) add("bad", `LINE token ใช้ไม่ได้: ${r.error}`);
    else {
      add("ok", `บอท LINE "${r.name}" ใช้ได้`);
      if (r.limit) add(r.used >= r.limit * 0.8 ? "warn" : "ok", `ข้อความ push เดือนนี้ใช้ไป ${r.used} จาก ${r.limit} (ตัวเลขจาก LINE)`);
    }
    if (!config.publicUrl) add("warn", "ไม่มี PUBLIC_URL ภาพหน้าจอและรูปสินค้าจะไม่ขึ้นใน LINE");
    if (!config.adminLineId) add("warn", "ยังไม่ได้ตั้ง ADMIN_LINE_ID คุณจะไม่ได้ข้อความแจ้งเมื่อมีคนแจ้งโอนหรือขอคืนเงินที่ต้องตรวจ (พิมพ์ \"เครดิต\" หาบอทเพื่อดูรหัสของคุณ)");
    else add("ok", "แจ้งเตือนผู้ก่อตั้งทาง LINE เปิดอยู่");
  }

  // Screenshots are evidence; without Playwright jobs still run, with links only.
  add(probe.playwright() ? "ok" : "warn", probe.playwright() ? "Playwright พร้อมถ่ายภาพหน้าจอหลักฐาน" : "ไม่มี Playwright งานยังทำได้ แต่ไม่มีภาพหน้าจอหลักฐาน");

  return out.sort((a, b) => LEVEL[a.level] - LEVEL[b.level]);
}

export const formatSetup = (list) =>
  `${list.map((c) => `${MARK[c.level]} ${c.text}`).join("\n")}\n\n${list.some((c) => c.level === "bad") ? "มีข้อที่ต้องแก้ (✗) ก่อนชวนผู้ทดลอง" : "ไม่มีข้อที่ต้องแก้ก่อนเริ่ม ข้อที่มี ! ควรดูด้วย"}`;

// The real probes, for the CLI.
export function liveProbes(config, { Anthropic, fetchImpl = fetch, lineLogin }) {
  const backups = join(dirname(config.dbPath), "backups");
  const lineGet = (path) => fetchImpl(`https://api.line.me/v2/bot/${path}`, { headers: { Authorization: `Bearer ${config.lineToken}` } })
    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${await r.text()}`))));
  return {
    lineLogin,
    async claude() {
      if (config.openrouterKey) {
        try { // the key works and how much credit is left: OpenRouter's own numbers
          const r = await fetchImpl("https://openrouter.ai/api/v1/credits", { headers: { Authorization: `Bearer ${config.openrouterKey}` } });
          if (!r.ok) return { ok: false, error: `${r.status} ${(await r.text()).slice(0, 120)}` };
          const { data } = await r.json();
          return { ok: true, left: data.total_credits - data.total_usage };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }
      try {
        await new Anthropic().models.retrieve(config.model); // free: checks the key and that this model is open to it
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `${err.status ?? ""} ${err.error?.error?.message ?? err.message}`.trim().slice(0, 160) }; // the API's own words, not its JSON
      }
    },
    async line() {
      try {
        const [info, quota, usage] = await Promise.all([lineGet("info"), lineGet("message/quota"), lineGet("message/quota/consumption")]);
        return { ok: true, name: info.displayName, limit: quota.type === "limited" ? quota.value : 0, used: usage.totalUsage };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    writable: () => existsSync(config.dbPath) || existsSync(dirname(config.dbPath)),
    backupAgeHours() {
      if (!existsSync(backups)) return null;
      const times = readdirSync(backups).filter((f) => f.endsWith(".db")).map((f) => statSync(join(backups, f)).mtimeMs);
      return times.length ? (Date.now() - Math.max(...times)) / 3600e3 : null;
    },
    playwright() {
      try {
        return existsSync(createRequire(import.meta.url)("playwright").chromium.executablePath());
      } catch {
        return false;
      }
    },
  };
}
