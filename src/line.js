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

// LINE shows JPEG and PNG only, and wants percent-encoded links of at most 1000 characters.
export const lineCanShow = (file) => /\.(jpg|png)$/.test(file || "");
const link = (url) => {
  try {
    const href = new URL(url).href.replace(/[|^`{}\\"<>]/g, encodeURIComponent); // URL leaves these raw in a query; LINE wants RFC 3986
    return href.length <= 1000 ? href : "";
  } catch {
    return "";
  }
};
// A swipeable row of option cards (Flex Message): product picture, name, price, note, the shop and a button to the page.
export const optionCards = (options, publicUrl) => ({
  type: "flex",
  altText: `ตัวเลือกที่เจอ: ${options.map((o) => o.name).join(", ")}`.slice(0, 400),
  contents: {
    type: "carousel",
    contents: options.map((o) => ({
      type: "bubble",
      size: "kilo",
      ...(lineCanShow(o.image) && { hero: { type: "image", url: publicUrl + o.image, size: "full", aspectRatio: "1:1", aspectMode: "cover" } }),
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: o.name?.trim() || "ตัวเลือก", weight: "bold", wrap: true, maxLines: 3 },
          o.price?.trim() && { type: "text", text: o.price.trim(), weight: "bold", size: "xl", color: "#0B1B4D" },
          o.note?.trim() && { type: "text", text: o.note.trim(), size: "sm", color: "#4A5778", wrap: true },
          link(o.url) && {
            type: "box", layout: "horizontal", spacing: "sm", alignItems: "center", // the shop: its logo and its name
            contents: [
              o.logo && { type: "image", url: publicUrl + o.logo, size: "20px", flex: 0 },
              { type: "text", text: new URL(o.url).hostname.replace(/^www\./, ""), size: "xs", color: "#4A5778" },
            ].filter(Boolean),
          },
        ].filter(Boolean),
      },
      ...(link(o.url) && { footer: { type: "box", layout: "vertical", contents: [{ type: "button", style: "primary", color: "#0A4BFF", height: "sm", action: { type: "uri", label: "เปิดดู", uri: link(o.url) } }] } }),
    })),
  },
});
