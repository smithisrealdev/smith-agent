// The server's /api/* (src/web.js), the same calls public/app.js makes. The phone keeps a random token in the
// keychain; the server stores only its hash and links it to the LINE or Apple account it signed in as.
import * as SecureStore from "expo-secure-store";
import { getRandomBytes } from "expo-crypto";

export const BASE = (process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000").replace(/\/$/, "");
export const full = (path: string) => (/^https?:\/\//.test(path) ? path : BASE + path); // /evidence/... and /logo/... pictures

export class LoginNeeded extends Error {}
export class RoundFull extends Error {} // the server takes no new accounts in this test round

const hex = (n: number) => Array.from(getRandomBytes(n), (b) => b.toString(16).padStart(2, "0")).join("");
let token: string | null = null;
async function deviceToken() {
  token ??= await SecureStore.getItemAsync("smith.token");
  if (!token) await newToken();
  return token as string;
}
// After sign-out or account deletion: a fresh token, so the old one stays unlinked on the server.
export async function newToken() {
  token = hex(24);
  await SecureStore.setItemAsync("smith.token", token);
}

export type Res<T = any> = { ok: boolean; status: number; data: T };
export async function api<T = any>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Res<T>> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${await deviceToken()}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("offline");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.error === "login") throw new LoginNeeded();
  if (res.status === 403 && data.error === "full") throw new RoundFull();
  return { ok: res.ok, status: res.status, data };
}

// Small values kept on the phone (consent, settings, the draft in the order box).
export const saved = {
  async get<T>(k: string): Promise<T | null> {
    try {
      return JSON.parse((await SecureStore.getItemAsync(`smith.${k}`)) || "null");
    } catch {
      return null;
    }
  },
  set: (k: string, v: unknown) => (v === null ? SecureStore.deleteItemAsync(`smith.${k}`) : SecureStore.setItemAsync(`smith.${k}`, JSON.stringify(v))).catch(() => {}),
};

// What the server sends, as the screens use it (jobView in src/web.js).
export type Step = { text: string; host?: string; at?: string };
export type Option = { name: string; price?: string; note?: string; url?: string; image?: string; brand?: string };
export type ChatEntry = { role: "user" | "smith"; text: string; at: string; job?: number | null; child?: { id: number; status: string; price: number; title: string; steps: string[] } };
export type Job = {
  id: number; text: string; title: string; steps: string[]; price: number; minutes: number; status: string; reason: string;
  answer: string; sources: { title?: string; url: string }[]; options: Option[]; codes: { code: string; shop?: string; note?: string; url?: string }[];
  coverage: { searches?: number; pages?: number; hosts?: string[]; blocked?: string[] } | null; evidence: string; parentId: number | null;
  chat: ChatEntry[]; createdAt: string; startedAt: string | null; finishedAt: string | null;
  progress?: Step[]; live?: { page?: string; frame?: { url: string; image: string } | null } | null;
};
export type Pack = { id: string; price: number; credit: number };
export type Me = { id: string; credit: number; login: string | null; apple?: boolean; prices: { S: number; M: number; L: number }; packs?: Pack[] };
