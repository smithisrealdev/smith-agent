import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSetup, formatSetup } from "../src/doctor.js";

const SIZES = { S: { price: 5 }, M: { price: 9 }, L: { price: 15 } };
const good = { model: "claude-opus-5-5", dbPath: "/data/smith.db", adminToken: "x".repeat(32), startCredit: 27, inviteCode: "abc", maxUsers: 30,
  dailyCostCap: 500, topup: null, lineToken: "t", lineSecret: "s", publicUrl: "https://smith.example" };
const probes = (over = {}) => ({ lineLogin: true, claude: async () => ({ ok: true }), line: async () => ({ ok: true, name: "Smith", limit: 300, used: 12 }),
  writable: () => true, backupAgeHours: () => 3, playwright: () => true, ...over });
const levels = (list) => list.map((c) => c.level);

test("a server set up as the README says passes with nothing to fix", async () => {
  const list = await checkSetup({ ANTHROPIC_API_KEY: "k", RENDER: "true" }, good, SIZES, probes());
  assert.ok(!levels(list).includes("bad"), formatSetup(list));
  assert.match(formatSetup(list), /ข้อความ push เดือนนี้ใช้ไป 12 จาก 300 \(ตัวเลขจาก LINE\)/);
  assert.match(formatSetup(list), /ไม่มีข้อที่ต้องแก้ก่อนเริ่ม/);
});

test("the mistakes that cost money or data are flagged first", async () => {
  const env = { RENDER: "true" }; // no Claude key
  const config = { ...good, dbPath: "data/smith.db", startCredit: 200, inviteCode: "", maxUsers: 0 };
  const list = await checkSetup(env, config, SIZES, probes({ lineLogin: false, line: async () => ({ ok: false, error: "401" }) }));
  const text = formatSetup(list);
  assert.equal(list[0].level, "bad", "worst first");
  assert.match(text, /✗ ยังไม่ได้ตั้ง ANTHROPIC_API_KEY/);
  assert.match(text, /✗ ฐานข้อมูลอยู่ที่ data\/smith.db ไม่ใช่ดิสก์ \/data/);
  assert.match(text, /✗ ไม่มี WEB_INVITE_CODE และไม่ได้เปิดเข้าสู่ระบบด้วย LINE/);
  assert.match(text, /✗ LINE token ใช้ไม่ได้: 401/);
  assert.match(text, /! เครดิตเริ่มต้น ฿200 มากกว่า 3 งานกลาง \(฿27\)/);
  assert.match(text, /! ไม่ได้ตั้ง MAX_USERS/);
  assert.match(text, /มีข้อที่ต้องแก้/);
});

test("LINE close to its monthly quota is a warning", async () => {
  const list = await checkSetup({ ANTHROPIC_API_KEY: "k" }, good, SIZES, probes({ line: async () => ({ ok: true, name: "Smith", limit: 300, used: 250 }) }));
  assert.ok(list.some((c) => c.level === "warn" && /250 จาก 300/.test(c.text)));
});
