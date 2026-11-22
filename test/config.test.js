import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// config.js reads the environment when it is first loaded, so each case loads it in a fresh process.
const load = (env) => {
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", 'const { SIZES, config } = await import("./src/config.js"); console.log(JSON.stringify({ prices: [SIZES.S.price, SIZES.M.price, SIZES.L.price], credit: config.startCredit, cap: config.dailyCostCap, admin: Boolean(config.adminToken) }))'], {
      env: { PATH: process.env.PATH, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, ...JSON.parse(out) };
  } catch (err) {
    return { ok: false, message: String(err.stderr) };
  }
};

test("prices default to 5 / 12 / 15, the starting credit to one medium job, and both can be set in whole baht", () => {
  assert.deepEqual(load({}), { ok: true, prices: [5, 12, 15], credit: 12, cap: 500, admin: false });
  assert.equal(load({ PRICE_M: "10" }).credit, 10, "the trial credit follows the medium price");
  assert.deepEqual(load({ PRICE_M: "12", PRICE_L: "20", START_CREDIT: "36", DAILY_COST_CAP: "300" }), { ok: true, prices: [5, 12, 20], credit: 36, cap: 300, admin: false });
  assert.equal(load({ DAILY_COST_CAP: "0" }).cap, 0, "0 turns the daily cap off");
  assert.equal(load({ START_CREDIT: "0" }).credit, 0, "a starting credit of zero is allowed");
  assert.deepEqual(load({ PRICE_M: "" }).prices, [5, 12, 15], "an empty value is the same as not set");
});

test("a mistyped price or credit stops the server instead of quietly using another number", () => {
  for (const [name, value] of [["PRICE_M", "12฿"], ["PRICE_M", "9.5"], ["PRICE_S", "0"], ["PRICE_L", "-3"], ["START_CREDIT", "abc"], ["START_CREDIT", "1.5"], ["DAILY_COST_CAP", "500฿"], ["DAILY_COST_CAP", "-1"]]) {
    const r = load({ [name]: value });
    assert.equal(r.ok, false, `${name}=${value}`);
    assert.match(r.message, new RegExp(`${name} must be a whole number`), `${name}=${value}`);
  }
});

test("the staff download token must be long enough to be safe, and is off when it is not set", () => {
  assert.equal(load({ ADMIN_TOKEN: "a".repeat(32) }).admin, true);
  assert.equal(load({ ADMIN_TOKEN: "" }).admin, false);
  const short = load({ ADMIN_TOKEN: "a".repeat(31) });
  assert.equal(short.ok, false);
  assert.match(short.message, /ADMIN_TOKEN must be at least 32 characters/);
});

test("a bigger job may not cost less than a smaller one", () => {
  const r = load({ PRICE_M: "20" }); // L is still 15
  assert.equal(r.ok, false);
  assert.match(r.message, /must not go down with size/);
  assert.equal(load({ PRICE_S: "9" }).ok, true, "equal prices are fine");
});

test("the model defaults to DeepSeek V4 Flash with an OpenRouter key, to Claude Opus without one, and SMITH_MODEL wins over both", () => {
  const model = (env) => execFileSync(process.execPath, ["--input-type=module", "-e", 'const { config } = await import("./src/config.js"); console.log(config.model)'], {
    env: { PATH: process.env.PATH, ...env }, encoding: "utf8",
  }).trim();
  assert.equal(model({ OPENROUTER_API_KEY: "k" }), "deepseek/deepseek-v4-flash");
  assert.equal(model({}), "claude-opus-5-5");
  assert.equal(model({ OPENROUTER_API_KEY: "k", SMITH_MODEL: "z-ai/glm-5.3" }), "z-ai/glm-5.3");
});
