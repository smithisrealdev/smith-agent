import { randomBytes } from "node:crypto";

// LINE Login (OAuth 2.1 / OpenID Connect, v2.1 endpoints): the web app's sign-in,
// so an account follows the person across phones and results can be pushed to their LINE chat.
export function createLineLogin({ channelId, channelSecret, callbackUrl, fetchImpl = fetch, now = Date.now }) {
  // shortcut: logins in progress live in memory, so a restart drops them (the user taps again); move to the DB when running more than one server
  const pending = new Map(); // state -> { key, nonce, expires }
  const form = (body) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });

  const claimsOf = async (verifyRes) => {
    if (!verifyRes.ok) throw new Error(`LINE verify ${verifyRes.status}`);
    const claims = await verifyRes.json();
    if (!claims.sub || claims.aud !== channelId) throw new Error("ID token not for this channel");
    return claims.sub;
  };

  return {
    // `key` identifies the phone that started the login; LINE hands `state` back to the callback.
    start(key) {
      for (const [s, p] of pending) if (p.expires < now()) pending.delete(s);
      const state = randomBytes(24).toString("hex");
      const nonce = randomBytes(16).toString("hex");
      pending.set(state, { key, nonce, expires: now() + 10 * 60e3 });
      const q = new URLSearchParams({
        response_type: "code",
        client_id: channelId,
        redirect_uri: callbackUrl,
        state,
        scope: "profile openid",
        nonce,
        bot_prompt: "normal", // an add-friend choice on the consent page (so results can be sent to the chat); "aggressive" adds a page after it
      });
      return `https://access.line.me/oauth2/v2.1/authorize?${q}`;
    },

    // Exchange the code, then let LINE verify the ID token (signature, audience, expiry, nonce).
    async finish(state, code) {
      const p = pending.get(state);
      pending.delete(state); // single use
      if (!p || p.expires < now()) throw new Error("unknown or expired state");
      const tokenRes = await fetchImpl("https://api.line.me/oauth2/v2.1/token",
        form({ grant_type: "authorization_code", code, redirect_uri: callbackUrl, client_id: channelId, client_secret: channelSecret }));
      if (!tokenRes.ok) throw new Error(`LINE token ${tokenRes.status}`);
      const { id_token: idToken } = await tokenRes.json();
      if (!idToken) throw new Error("LINE returned no ID token");
      const verifyRes = await fetchImpl("https://api.line.me/oauth2/v2.1/verify", form({ id_token: idToken, client_id: channelId, nonce: p.nonce }));
      return { key: p.key, userId: await claimsOf(verifyRes) };
    },

    // The phone app signs in with the LINE SDK, which hands it an ID token for this same channel: LINE checks it.
    async verifyNative(idToken) {
      if (!idToken || typeof idToken !== "string") throw new Error("no ID token");
      return claimsOf(await fetchImpl("https://api.line.me/oauth2/v2.1/verify", form({ id_token: idToken, client_id: channelId })));
    },
  };
}
