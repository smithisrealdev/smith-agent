import { createHash, createPublicKey, sign, verify } from "node:crypto";

const ISS = "https://appleid.apple.com";
const part = (s) => JSON.parse(Buffer.from(s, "base64url"));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

// Sign in with Apple for the iOS app (App Review 4.8 asks for it next to LINE). The phone sends Apple's identity
// token (an RS256 JWT) and the raw nonce whose sha256 it gave Apple; the account is "apple:<Apple's user id>".
// With an Apple key (team id, key id, .p8), the sign-in code is kept as a refresh token so deleting the account
// can revoke it (App Review 5.1.1(v)).
export function createAppleLogin({ bundleId, teamId = "", keyId = "", privateKey = "", fetchImpl = fetch, now = Date.now }) {
  let keys = null; // Apple's public keys, by kid
  let keysAt = 0;
  const keyFor = async (kid) => {
    if (!keys || !keys.has(kid) || now() - keysAt > 24 * 3600e3) {
      const r = await fetchImpl(`${ISS}/auth/keys`);
      if (!r.ok) throw new Error(`Apple keys ${r.status}`);
      keys = new Map((await r.json()).keys.map((k) => [k.kid, createPublicKey({ key: k, format: "jwk" })]));
      keysAt = now();
    }
    const key = keys.get(kid);
    if (!key) throw new Error("unknown Apple key");
    return key;
  };
  const form = (body) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  // The client secret Apple asks for: an ES256 JWT signed with the .p8 key, good for 5 minutes.
  const clientSecret = () => {
    const iat = Math.floor(now() / 1000);
    const head = `${b64({ alg: "ES256", kid: keyId })}.${b64({ iss: teamId, iat, exp: iat + 300, aud: ISS, sub: bundleId })}`;
    return `${head}.${sign("sha256", Buffer.from(head), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  const hasKey = Boolean(teamId && keyId && privateKey);

  return {
    async verify(identityToken, rawNonce) {
      const [h, p, s] = String(identityToken || "").split(".");
      let head, claims;
      try {
        head = part(h);
        claims = part(p);
      } catch {
        throw new Error("bad Apple token");
      }
      if (head.alg !== "RS256" || !s) throw new Error("bad Apple token");
      if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), await keyFor(head.kid), Buffer.from(s, "base64url"))) throw new Error("Apple token signature");
      if (claims.iss !== ISS) throw new Error("Apple token issuer");
      if (claims.aud !== bundleId) throw new Error("Apple token audience");
      if (!(claims.exp * 1000 > now())) throw new Error("Apple token expired");
      if (!rawNonce || claims.nonce !== createHash("sha256").update(String(rawNonce)).digest("hex")) throw new Error("Apple token nonce");
      if (!claims.sub) throw new Error("bad Apple token");
      return `apple:${claims.sub}`;
    },
    async refreshToken(code) {
      if (!hasKey || !code) return null;
      const r = await fetchImpl(`${ISS}/auth/token`, form({ client_id: bundleId, client_secret: clientSecret(), code, grant_type: "authorization_code" }));
      if (!r.ok) throw new Error(`Apple token ${r.status}`);
      return (await r.json()).refresh_token || null;
    },
    async revoke(refreshToken) {
      if (!hasKey || !refreshToken) return;
      const r = await fetchImpl(`${ISS}/auth/revoke`, form({ client_id: bundleId, client_secret: clientSecret(), token: refreshToken, token_type_hint: "refresh_token" }));
      if (!r.ok) throw new Error(`Apple revoke ${r.status}`);
    },
  };
}
