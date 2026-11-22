import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, makeStore } from "../src/db.js";
import { createPush } from "../src/push.js";

test("a finished job is pushed to every phone of its user, and a phone Expo no longer knows is forgotten", async () => {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  store.addPushToken("U1", "ExponentPushToken[a]");
  store.addPushToken("U1", "ExponentPushToken[b]");
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] }) };
  };
  const push = createPush({ store, fetchImpl });
  await push.job({ id: 7, user_id: "U1", title: "หาหูฟัง" }, { ok: true });
  assert.equal(sent[0].url, "https://exp.host/--/api/v2/push/send");
  assert.deepEqual(sent[0].body.map((m) => m.to), ["ExponentPushToken[a]", "ExponentPushToken[b]"]);
  assert.deepEqual(sent[0].body[0], { to: "ExponentPushToken[a]", title: "งานเสร็จแล้ว", body: "หาหูฟัง", data: { jobId: 7 }, sound: "default" });
  assert.deepEqual(store.pushTokensOf("U1"), ["ExponentPushToken[a]"]);

  await push.job({ id: 8, user_id: "U1", title: "หาเมาส์" }, { ok: false });
  assert.equal(sent[1].body[0].title, "งานนี้ไม่สำเร็จ ไม่เสียเงิน");
  await push.job({ id: 9, user_id: "U2", title: "x" }, { ok: true });
  assert.equal(sent.length, 2, "no phone, no push");
  await push.job(null, { ok: true }); // the account was deleted while the job ran
});

test("a push that fails never throws", async () => {
  const store = makeStore(openDb(":memory:"), { startCredit: 20 });
  store.addPushToken("U1", "ExponentPushToken[a]");
  const push = createPush({ store, fetchImpl: async () => { throw new Error("offline"); }, log: { error() {} } });
  await push.job({ id: 1, user_id: "U1", title: "t" }, { ok: true });
});
