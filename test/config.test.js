import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// config.js reads the environment when it is first loaded, so each case loads it in a fresh process.
const load = (env) => {
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", 'const { SIZES, config } = await import("./src/config.js"); console.log(JSON.stringify({ prices: [SIZES.S.price, SIZES.M.price, SIZES.L.price], credit: config.startCredit }))'], {
      env: { PATH: process.env.PATH, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, ...JSON.parse(out) };
  } catch (err) {
    return { ok: false, message: String(err.stderr) };
  }
};

test("prices and the starting credit default to 5 / 9 / 15 and 20, and can be set in whole baht", () => {
  assert.deepEqual(load({}), { ok: true, prices: [5, 9, 15], credit: 20 });
  assert.deepEqual(load({ PRICE_M: "12", PRICE_L: "20", START_CREDIT: "36" }), { ok: true, prices: [5, 12, 20], credit: 36 });
  assert.equal(load({ START_CREDIT: "0" }).credit, 0, "a starting credit of zero is allowed");
  assert.deepEqual(load({ PRICE_M: "" }).prices, [5, 9, 15], "an empty value is the same as not set");
});

test("a mistyped price or credit stops the server instead of quietly using another number", () => {
  for (const [name, value] of [["PRICE_M", "12฿"], ["PRICE_M", "9.5"], ["PRICE_S", "0"], ["PRICE_L", "-3"], ["START_CREDIT", "abc"], ["START_CREDIT", "1.5"]]) {
    const r = load({ [name]: value });
    assert.equal(r.ok, false, `${name}=${value}`);
    assert.match(r.message, new RegExp(`${name} must be a whole number`), `${name}=${value}`);
  }
});

test("a bigger job may not cost less than a smaller one", () => {
  const r = load({ PRICE_M: "20" }); // L is still 15
  assert.equal(r.ok, false);
  assert.match(r.message, /must not go down with size/);
  assert.equal(load({ PRICE_S: "9" }).ok, true, "equal prices are fine");
});
