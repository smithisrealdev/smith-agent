// Admin commands for the experiment:
//   node src/cli.js stats                     the experiment's numbers
//   node src/cli.js jobs [n]                  the last n jobs, with why each failed or was refunded
//   node src/cli.js grant <lineUserId> <baht> add credit for a tester
//   node src/cli.js backup                    copy the database now, next to it, and print where
//   node src/cli.js restore <file> yes        replace the database with a backup, then restart the server
//   node src/cli.js queue                     refunds waiting for review, wrong-price claims first
//   node src/cli.js refund <jobId>            approve a refund waiting for review
import { config } from "./config.js";
import { openDb, makeStore } from "./db.js";
import { stats, formatStats, formatJobs, formatQueue } from "./stats.js";
import { backupDb, restoreDb } from "./backup.js";
import { dirname, join } from "node:path";

const [cmd, a, b] = process.argv.slice(2);
const db = openDb(config.dbPath);
const store = makeStore(db, config);

if (cmd === "stats") {
  console.log(formatStats(stats(db)));
} else if (cmd === "jobs") {
  console.log(formatJobs(db, Number(a) || 20));
} else if (cmd === "grant" && a && Number.isInteger(Number(b))) {
  console.log(`credit of ${a}: ฿${store.grant(a, Number(b)).credit}`);
} else if (cmd === "backup") {
  console.log(await backupDb(db, join(dirname(config.dbPath), "backups")));
} else if (cmd === "restore" && a) {
  if (b !== "yes") {
    console.log(`This replaces the live database ${config.dbPath} with ${a}. Anything since that backup is lost.\nRun it again with the word yes at the end to go ahead, then restart the server.`);
    process.exitCode = 1;
  } else {
    await restoreDb(a, config.dbPath);
    console.log("restored. Restart the server now so it opens the restored database.");
  }
} else if (cmd === "queue") {
  console.log(formatQueue(db));
} else if (cmd === "refund" && Number(a)) {
  console.log(store.forceRefund(Number(a)) ? `refunded job ${a}` : `job ${a} is not refundable`);
} else {
  console.log("usage: node src/cli.js stats | jobs [n] | queue | backup | restore <file> yes | grant <userId> <baht> | refund <jobId>");
  process.exitCode = 1;
}
