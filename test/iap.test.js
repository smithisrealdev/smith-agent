import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, generateKeyPairSync, sign, verify as verifySig, createPrivateKey } from "node:crypto";
import { createIap } from "../src/iap.js";

const PACKS = [{ id: "credit_50", price: 59, credit: 50 }, { id: "credit_100", price: 119, credit: 100 }];
const NOW = Date.now() + 3600e3; // an hour after the test certificates are made (openssl rounds their start to the second)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

// A stand-in for Apple's certificate chain, made with openssl: root CA, an intermediate carrying Apple's WWDR marker
// and a leaf carrying the App Store receipt-signing marker (the OIDs Apple documents).
let chain; // { der: [leaf, inter, root], key, rootFingerprint, stranger }
before(() => {
  const d = mkdtempSync(join(tmpdir(), "iap-"));
  const ssl = (...a) => execFileSync("openssl", a, { cwd: d, stdio: "pipe" });
  const ext = (name, body) => writeFileSync(join(d, name), body);
  for (const k of ["root", "inter", "leaf", "plain"]) ssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${k}.key`);
  ssl("req", "-x509", "-new", "-key", "root.key", "-subj", "/CN=Test Root", "-days", "3650", "-out", "root.pem", "-addext", "basicConstraints=critical,CA:TRUE");
  ext("inter.ext", "basicConstraints=critical,CA:TRUE\n1.2.840.113635.100.6.2.1=ASN1:NULL\n");
  ext("leaf.ext", "basicConstraints=critical,CA:FALSE\n1.2.840.113635.100.6.11.1=ASN1:NULL\n");
  ext("plain.ext", "basicConstraints=critical,CA:FALSE\n");
  const issue = (name, ca, extFile) => {
    ssl("req", "-new", "-key", `${name}.key`, "-subj", `/CN=${name}`, "-out", `${name}.csr`);
    ssl("x509", "-req", "-in", `${name}.csr`, "-CA", `${ca}.pem`, "-CAkey", `${ca}.key`, "-CAcreateserial", "-days", "3650", "-extfile", extFile, "-out", `${name}.pem`);
  };
  issue("inter", "root", "inter.ext");
  issue("leaf", "inter", "leaf.ext");
  issue("plain", "inter", "plain.ext");
  const der = (n) => ssl("x509", "-in", `${n}.pem`, "-outform", "DER");
  chain = {
    der: ["leaf", "inter", "root"].map(der),
    key: createPrivateKey(readFileSync(join(d, "leaf.key"))),
    plain: { der: der("plain"), key: createPrivateKey(readFileSync(join(d, "plain.key"))) },
  };
  chain.rootFingerprint = createHash("sha256").update(chain.der[2]).digest("hex");
});

const jws = (payload, { certs = chain.der, key = chain.key } = {}) => {
  const head = `${b64({ alg: "ES256", x5c: certs.map((c) => c.toString("base64")) })}.${b64(payload)}`;
  return `${head}.${sign("sha256", Buffer.from(head), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
};
const tx = { transactionId: "2000000111", productId: "credit_50", bundleId: "com.smithagent.app", type: "Consumable", environment: "Sandbox" };

function google({ state = 0 } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") return { ok: true, status: 200, json: async () => ({ access_token: "gat", expires_in: 3600 }) };
    return { ok: true, status: 200, json: async () => ({ purchaseState: state, orderId: "GPA.1", productId: "credit_100" }) };
  };
  const iap = createIap({
    packs: PACKS,
    google: { packageName: "com.smithagent.app", serviceAccount: { client_email: "smith@p.iam.gserviceaccount.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }) } },
    fetchImpl,
    now: () => NOW,
  });
  return { iap, calls, publicKey };
}
const apple = () => createIap({ packs: PACKS, apple: { bundleId: "com.smithagent.app", rootFingerprint: chain.rootFingerprint }, now: () => NOW });

test("an App Store transaction signed through Apple's chain, for our app and a known pack, is good for that pack's credit", async () => {
  assert.deepEqual(await apple().verify({ platform: "ios", productId: "credit_50", receipt: jws(tx) }), { platform: "ios", transactionId: "2000000111", productId: "credit_50", credit: 50 });
});

test("App Store transactions that are forged, foreign, revoked or for another pack are refused", async () => {
  const iap = apple();
  const no = (receipt, productId = "credit_50") => assert.rejects(iap.verify({ platform: "ios", productId, receipt }));
  await no(jws(tx, { key: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey })); // not signed by the leaf
  await no(jws(tx, { certs: [chain.plain.der, chain.der[1], chain.der[2]], key: chain.plain.key })); // a cert without the receipt marker
  await no(jws(tx, { certs: [chain.der[0], chain.der[1]] })); // no root
  await no(jws({ ...tx, bundleId: "com.other.app" }));
  await no(jws({ ...tx, revocationDate: NOW - 1 }));
  await no(jws(tx), "credit_100"); // receipt for 50, asks for 100
  await no(jws({ ...tx, productId: "credit_999" }), "credit_999"); // not a pack we sell
  await no("garbage");
  const otherRoot = createIap({ packs: PACKS, apple: { bundleId: "com.smithagent.app", rootFingerprint: "00".repeat(32) }, now: () => NOW });
  await assert.rejects(otherRoot.verify({ platform: "ios", productId: "credit_50", receipt: jws(tx) }), /root/);
});

test("Apple's signed notifications are read through the same chain", async () => {
  const note = { notificationType: "REFUND", data: { signedTransactionInfo: jws(tx) } };
  const r = await apple().appleNotification(jws(note));
  assert.equal(r.type, "REFUND");
  assert.equal(r.transactionId, "2000000111");
  await assert.rejects(apple().appleNotification(jws(note, { key: chain.plain.key })));
});

test("a Play purchase is checked with Google using a service-account token, and the purchase token is its id", async () => {
  const { iap, calls, publicKey } = google();
  assert.deepEqual(await iap.verify({ platform: "android", productId: "credit_100", receipt: "ptok-1" }), { platform: "android", transactionId: "ptok-1", productId: "credit_100", credit: 100 });
  const assertion = Object.fromEntries(new URLSearchParams(calls[0].init.body)).assertion;
  const [h, p, s] = assertion.split(".");
  assert.ok(verifySig("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url")));
  assert.equal(JSON.parse(Buffer.from(p, "base64url")).scope, "https://www.googleapis.com/auth/androidpublisher");
  assert.equal(calls[1].url, "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.smithagent.app/purchases/products/credit_100/tokens/ptok-1");
  assert.equal(calls[1].init.headers.Authorization, "Bearer gat");
  await iap.verify({ platform: "android", productId: "credit_100", receipt: "ptok-2" });
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1, "the Google token is reused until it expires");
});

test("a Play purchase that is pending or cancelled is refused, and so is a platform that is not set up", async () => {
  await assert.rejects(google({ state: 2 }).iap.verify({ platform: "android", productId: "credit_100", receipt: "p" }), /not paid/);
  await assert.rejects(google({ state: 1 }).iap.verify({ platform: "android", productId: "credit_100", receipt: "p" }), /not paid/);
  await assert.rejects(google().iap.verify({ platform: "ios", productId: "credit_100", receipt: "p" }), /not set up/);
  await assert.rejects(apple().verify({ platform: "android", productId: "credit_50", receipt: "p" }), /not set up/);
});
