import { createHmac, timingSafeEqual } from "node:crypto";

// LINE signs every webhook body with the channel secret (HMAC-SHA256, base64).
export function verifySignature(secret, body, signature) {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(String(signature), "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function lineClient(token, fetchImpl = fetch) {
  const call = async (path, body) => {
    const res = await fetchImpl(`https://api.line.me/v2/bot/message/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LINE ${path} ${res.status}: ${await res.text()}`);
  };
  return {
    reply: (replyToken, messages) => call("reply", { replyToken, messages }),
    push: (to, messages) => call("push", { to, messages }),
  };
}

// Message builders. LINE limits: text 5000 characters, quick-reply and postback labels 20.
export const text = (t, actions = []) => ({
  type: "text",
  text: t.slice(0, 5000),
  ...(actions.length && { quickReply: { items: actions.map((action) => ({ type: "action", action })) } }),
});
export const postback = (label, data, displayText = label) => ({ type: "postback", label: label.slice(0, 20), data, displayText });
export const image = (url) => ({ type: "image", originalContentUrl: url, previewImageUrl: url });
