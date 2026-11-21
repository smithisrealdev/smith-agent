// Admin commands for the experiment:
//   node src/cli.js stats                     the experiment's numbers
//   node src/cli.js jobs [n]                  the last n jobs, with why each failed or was refunded
//   node src/cli.js grant <lineUserId> <baht> add credit for a tester
//   node src/cli.js refund <jobId>            approve a refund waiting for review
import { config } from "./config.js";
import { openDb, makeStore } from "./db.js";
import { stats, formatStats, formatJobs } from "./stats.js";

const [cmd, a, b] = process.argv.slice(2);
const db = openDb(config.dbPath);
const store = makeStore(db, config);

if (cmd === "stats") {
  console.log(formatStats(stats(db)));
} else if (cmd === "jobs") {
  console.log(formatJobs(db, Number(a) || 20));
} else if (cmd === "grant" && a && Number.isInteger(Number(b))) {
  console.log(`credit of ${a}: ฿${store.grant(a, Number(b)).credit}`);
} else if (cmd === "refund" && Number(a)) {
  console.log(store.forceRefund(Number(a)) ? `refunded job ${a}` : `job ${a} is not refundable`);
} else {
  console.log("usage: node src/cli.js stats | jobs [n] | grant <userId> <baht> | refund <jobId>");
  process.exitCode = 1;
}
