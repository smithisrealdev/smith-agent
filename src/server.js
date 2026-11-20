import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { openDb, makeStore } from "./db.js";
import { verifySignature, lineClient } from "./line.js";
import { quote, runTask } from "./agent.js";
import { screenshot } from "./evidence.js";
import { createBot } from "./bot.js";

if (!config.lineSecret || !config.lineToken) {
  console.error("Set LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN (see .env.example).");
  process.exit(1);
}

const store = makeStore(openDb(config.dbPath), config);
const bot = createBot({
  store,
  line: lineClient(config.lineToken),
  quote,
  runTask,
  screenshot,
  publicUrl: config.publicUrl,
  evidenceDir: config.evidenceDir,
});

const send = (res, status, body = "", type = "text/plain") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
};

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") return send(res, 200, "ok");
  const evidence = req.method === "GET" && /^\/evidence\/(\d+)\.png$/.exec(req.url);
  if (evidence) {
    try {
      return send(res, 200, await readFile(join(config.evidenceDir, `${evidence[1]}.png`)), "image/png");
    } catch {
      return send(res, 404);
    }
  }
  if (req.method !== "POST" || req.url !== "/webhook") return send(res, 404);

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
});

await bot.recover();
server.listen(config.port, () => console.log(`Smith Agent listening on :${config.port}`));
