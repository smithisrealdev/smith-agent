import { createServer } from "node:http";
import { config } from "./config.js";
import { openDb, makeStore } from "./db.js";
import { verifySignature, lineClient } from "./line.js";
import { quote, runTask } from "./agent.js";
import { screenshot } from "./evidence.js";
import { saveLogos } from "./logo.js";
import { saveImages } from "./image.js";
import { createRunner } from "./runner.js";
import { createBot } from "./bot.js";
import { createWeb } from "./web.js";
import { createLineLogin } from "./linelogin.js";

const store = makeStore(openDb(config.dbPath), config);
const runner = createRunner({ store, runTask, screenshot, saveLogos, saveImages, evidenceDir: config.evidenceDir });
const bot = config.lineSecret && config.lineToken
  ? createBot({ store, line: lineClient(config.lineToken), quote, runner, publicUrl: config.publicUrl })
  : null;
const lineLogin = config.lineLoginId && config.lineLoginSecret && config.publicUrl
  ? createLineLogin({ channelId: config.lineLoginId, channelSecret: config.lineLoginSecret, callbackUrl: `${config.publicUrl}/auth/line/callback` })
  : null;
const web = createWeb({
  store, quote, runner, lineLogin, notify: bot?.notify,
  evidenceDir: config.evidenceDir, inviteCode: config.inviteCode, quotesPerHour: config.quotesPerHour,
});

if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set: quotes and jobs will fail unless another Claude credential is configured.");
if (!bot) console.log("LINE is off (LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN not set): serving the web app only.");
console.log(lineLogin ? `Web sign-in: LINE Login (callback ${config.publicUrl}/auth/line/callback)` : "Web sign-in: none, each phone is its own account (set LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET and PUBLIC_URL to require LINE).");

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
