import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

// A consistent copy of the database, taken while the server keeps running (SQLite's VACUUM INTO reads a snapshot,
// so a job finishing at that moment cannot leave a half-written copy). Only the database is copied: the evidence
// pictures are not, and losing them costs the proof for old jobs, not anyone's credit.
// shortcut: it runs on the main thread and blocks it for as long as the copy takes; fine for a database of a few
// megabytes, move it to a worker or the sqlite3 command line when a copy takes more than a second.
export async function backupDb(db, dir, { keep = 7, now = new Date() } = {}) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error("keep must be at least 1");
  await mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); // 20261121T031500Z: sorts by time
  const file = join(dir, `smith-${stamp}.db`);
  await rm(file, { force: true }); // VACUUM INTO refuses to overwrite
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  const copies = (await readdir(dir)).filter((n) => /^smith-\d{8}T\d{6}Z\.db$/.test(n)).sort();
  for (const old of copies.slice(0, -keep)) await rm(join(dir, old), { force: true });
  return file;
}

// Put a backup in place of the live database. The copy is staged beside it and then renamed over it, so a server that
// is still running keeps writing to the old file (now unlinked) and cannot damage the restored one; restart the
// server afterwards so that it opens the restored file. The old -wal and -shm files are removed because they belong
// to the database being replaced.
export async function restoreDb(file, dbPath) {
  if (resolve(file) === resolve(dbPath)) throw new Error("the backup and the live database are the same file");
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const result = copy.prepare("PRAGMA integrity_check").get().integrity_check;
    if (result !== "ok") throw new Error(`the backup is damaged: ${result}`);
    const tables = new Set(copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
    for (const t of ["users", "jobs", "ledger"]) if (!tables.has(t)) throw new Error(`not a Smith database: it has no ${t} table`);
  } finally {
    copy.close();
  }
  const staged = `${dbPath}.restore`;
  await copyFile(file, staged);
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
  await rename(staged, dbPath);
}
