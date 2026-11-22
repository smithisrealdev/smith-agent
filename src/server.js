import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { config, PACKS } from "./config.js";
import { openDb, makeStore } from "./db.js";
import { verifySignature, lineClient } from "./line.js";
import { quote, chat, talk, runTask } from "./agent.js";
import { screenshot } from "./evidence.js";
import { saveLogos } from "./logo.js";
import { saveImages } from "./image.js";
import { createRunner } from "./runner.js";
import { createBot } from "./bot.js";
import { createAlerts, ALERT } from "./alerts.js";
import { createChat } from "./chat.js";
import { createTalk } from "./talk.js";
import { createWeb } from "./web.js";
import { createLineLogin } from "./linelogin.js";
import { createAdmin } from "./admin.js";
import { createAppleLogin } from "./apple.js";
import { createIap, APPLE_ROOT_G3 } from "./iap.js";
import { createPush } from "./push.js";
import { backupDb } from "./backup.js";
import { dirname, join } from "node:path";

const db = openDb(config.dbPath);
const store = makeStore(db, config);
const runner = createRunner({ store, runTask, screenshot, saveLogos, saveImages, evidenceDir: config.evidenceDir });
// Messages to the founder go out through the bot's channel, when LINE is set up and ADMIN_LINE_ID names them.
const alerts = createAlerts({ push: config.lineToken ? lineClient(config.lineToken).push : null, adminId: config.adminLineId });
// One set of chat rules for the app and LINE, so a job answers one question at a time whichever side asks.
const overCap = () => {
  const over = config.dailyCostCap > 0 && store.spentToday() >= config.dailyCostCap;
  if (over) alerts.once("cap", ALERT.cap(config.dailyCostCap));
  return over;
};
const chats = createChat({ store, chat, full: overCap });
const talks = createTalk({ store, talk, full: overCap, perHour: config.quotesPerHour }); // the chat before a job
const bot = config.lineSecret && config.lineToken
  ? createBot({ store, line: lineClient(config.lineToken), talks, chats, runner, publicUrl: config.publicUrl, dailyCostCap: config.dailyCostCap, maxUsers: config.maxUsers, topup: config.topup, alerts })
  : null;
const lineLogin = config.lineLoginId && config.lineLoginSecret && config.publicUrl
  ? createLineLogin({ channelId: config.lineLoginId, channelSecret: config.lineLoginSecret, callbackUrl: `${config.publicUrl}/auth/line/callback` })
  : null;
const apple = config.appleBundleId
  ? createAppleLogin({ bundleId: config.appleBundleId, teamId: config.appleTeamId, keyId: config.appleKeyId, privateKey: config.appleKeyFile ? readFileSync(config.appleKeyFile, "utf8") : "" })
  : null;
const iap = config.appleBundleId || config.playPackage
  ? createIap({
    packs: PACKS,
    apple: config.appleBundleId ? { bundleId: config.appleBundleId, rootFingerprint: APPLE_ROOT_G3 } : null,
    google: config.playPackage && config.playServiceAccountFile ? { packageName: config.playPackage, serviceAccount: JSON.parse(readFileSync(config.playServiceAccountFile, "utf8")) } : null,
  })
  : null;
const web = createWeb({
  store, quote, chats, talks, runner, lineLogin, apple, iap, packs: PACKS, push: createPush({ store }), notify: bot?.notify,
  evidenceDir: config.evidenceDir, inviteCode: config.inviteCode, quotesPerHour: config.quotesPerHour, dailyCostCap: config.dailyCostCap, maxUsers: config.maxUsers, topup: config.topup, alerts,
});

if (config.openrouterKey) console.log("Claude: through OpenRouter (OPENROUTER_API_KEY).");
else if (!process.env.ANTHROPIC_API_KEY) console.warn("Neither ANTHROPIC_API_KEY nor OPENROUTER_API_KEY is set: quotes and jobs will fail.");
if (!bot) console.log("LINE is off (LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN not set): serving the web app only.");
if (apple) console.log(`Phone app: Sign in with Apple and App Store purchases for ${config.appleBundleId}${config.appleKeyFile ? "" : " (no Apple key: deleted accounts are not revoked at Apple)"}.`);
if (config.playPackage && config.playServiceAccountFile) console.log(`Phone app: Google Play purchases for ${config.playPackage}.`);
console.log(lineLogin ? `Web sign-in: LINE Login (callback ${config.publicUrl}/auth/line/callback)` : "Web sign-in: none, each phone is its own account (set LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET and PUBLIC_URL to require LINE).");

// A copy of the database every day, kept for a week next to it. This guards against a bad edit or a corrupted file,
// not against losing the disk: keep a copy elsewhere by downloading /admin/backup (see the README).
const backupDir = join(dirname(config.dbPath), "backups");
const admin = createAdmin({ db, token: config.adminToken, backupDir });
const dailyBackup = () => backupDb(db, backupDir).then((f) => console.log("database copied to", f), (err) => console.error("backup failed", err));
if (config.dbPath !== ":memory:") {
  dailyBackup();
  setInterval(dailyBackup, 24 * 3600e3).unref();
}

const send = (res, status, body = "") => {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(body);
};

async function lineWebhook(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) return send(res, 413);
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  if (!verifySignature(config.lineSecret, body, req.headers["x-line-signature"])) return send(res, 401);
  send(res, 200); // answer LINE at once; the work happens after
  let events = [];
  try {
    events = JSON.parse(body).events || [];
  } catch {
    return;
  }
  for (const e of events) bot.handle(e).catch((err) => console.error("event failed", err));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") return send(res, 200, "ok");
    if (req.method === "POST" && req.url === "/webhook") return bot ? await lineWebhook(req, res) : send(res, 404);
    if (await admin(req, res)) return;
    if (await web(req, res)) return;
    send(res, 404);
  } catch (err) {
    console.error("request failed", err);
    if (!res.headersSent) send(res, 500);
  }
});

const cutShort = runner.recover();
if (bot) await bot.notifyRestart(cutShort);
server.listen(config.port, () => console.log(`Smith Agent on http://localhost:${config.port}`));
