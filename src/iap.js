import { X509Certificate, createHash, sign, verify } from "node:crypto";

// Apple's root of App Store signing, "Apple Root CA - G3" (apple.com/certificateauthority), as a SHA-256 fingerprint.
export const APPLE_ROOT_G3 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";
// Markers Apple puts in its certificates: WWDR intermediate, and the leaf that signs App Store data.
const OID_INTER = Buffer.from("060a2a864886f76364060201", "hex"); // 1.2.840.113635.100.6.2.1
const OID_LEAF = Buffer.from("060a2a864886f76364060b01", "hex"); // 1.2.840.113635.100.6.11.1
const part = (s) => JSON.parse(Buffer.from(s, "base64url"));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

// In-app credit packs: the phone buys from the App Store or Google Play and sends what the store gave it;
// this checks it with the store's own signature or API before any credit is added.
export function createIap({ packs, apple = null, google = null, fetchImpl = fetch, now = Date.now }) {
  const packOf = (id) => {
    const p = packs.find((x) => x.id === id);
    if (!p) throw new Error("unknown pack");
    return p;
  };

  // A StoreKit 2 JWS: ES256, signed by the first certificate of x5c, which chains to Apple's root.
  function appleJws(token) {
    const [h, p, s] = String(token || "").split(".");
    let head, payload;
    try {
      head = part(h);
      payload = part(p);
    } catch {
      throw new Error("bad App Store data");
    }
    const certs = (head.x5c || []).map((c) => new X509Certificate(Buffer.from(c, "base64")));
    if (head.alg !== "ES256" || certs.length !== 3 || !s) throw new Error("bad App Store data");
    const [leaf, inter, root] = certs;
    if (createHash("sha256").update(root.raw).digest("hex") !== apple.rootFingerprint) throw new Error("not Apple's root");
    const at = new Date(now());
    for (const c of certs) if (new Date(c.validFrom) > at || new Date(c.validTo) < at) throw new Error("certificate out of date");
    if (!root.verify(root.publicKey) || !inter.verify(root.publicKey) || !leaf.verify(inter.publicKey)) throw new Error("broken chain");
    if (!inter.raw.includes(OID_INTER) || !leaf.raw.includes(OID_LEAF)) throw new Error("not an App Store certificate");
    if (!verify("sha256", Buffer.from(`${h}.${p}`), { key: leaf.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))) throw new Error("App Store signature");
    return payload;
  }

  async function ios(productId, receipt) {
    const t = appleJws(receipt);
    if (t.bundleId !== apple.bundleId) throw new Error("another app's purchase");
    if (t.productId !== productId) throw new Error("another pack's purchase");
    if (t.revocationDate) throw new Error("refunded purchase");
    return String(t.transactionId);
  }

  let gToken = null; // { value, until }
  async function googleToken() {
    if (gToken && gToken.until > now()) return gToken.value;
    const iat = Math.floor(now() / 1000);
    const head = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: google.serviceAccount.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 })}`;
    const assertion = `${head}.${sign("RSA-SHA256", Buffer.from(head), google.serviceAccount.private_key).toString("base64url")}`;
    const r = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!r.ok) throw new Error(`Google token ${r.status}`);
    const j = await r.json();
    gToken = { value: j.access_token, until: now() + (j.expires_in - 60) * 1000 };
    return gToken.value;
  }

  async function android(productId, token) {
    if (!token || typeof token !== "string") throw new Error("no purchase token");
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(google.packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;
    const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${await googleToken()}` } });
    if (!r.ok) throw new Error(`Google purchase ${r.status}`);
    if ((await r.json()).purchaseState !== 0) throw new Error("not paid");
    return token;
  }

  return {
    async verify({ platform, productId, receipt }) {
      const pack = packOf(productId);
      if (platform === "ios" && apple) return { platform, transactionId: await ios(productId, receipt), productId, credit: pack.credit };
      if (platform === "android" && google) return { platform, transactionId: await android(productId, receipt), productId, credit: pack.credit };
      throw new Error("store not set up");
    },
    // App Store Server Notifications v2: a JWS whose transaction is another JWS.
    async appleNotification(signedPayload) {
      if (!apple) throw new Error("store not set up");
      const n = appleJws(signedPayload);
      const t = n.data?.signedTransactionInfo ? appleJws(n.data.signedTransactionInfo) : {};
      return { type: n.notificationType, transactionId: t.transactionId ? String(t.transactionId) : "" };
    },
  };
}
