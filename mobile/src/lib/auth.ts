// Signing in: the LINE SDK (same LINE user id as the bot, so LINE users still get results in their chat) and,
// on iOS, Sign in with Apple (App Review 4.8). Either way the server checks the token and links this phone to the account.
import { Platform } from "react-native";
import Line, { BotPrompt, Scope } from "@xmartlabs/react-native-line";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { api } from "./api";

const LINE_CHANNEL = process.env.EXPO_PUBLIC_LINE_CHANNEL_ID || "2012750284"; // the LINE Login channel (same provider as the bot)
let lineReady: Promise<unknown> | null = null;
const setupLine = () => (lineReady ??= Promise.resolve(Line.setup({ channelId: LINE_CHANNEL })));

export type SignIn = "ok" | "cancelled" | "failed" | "full";
const result = (status: number): SignIn => (status === 200 ? "ok" : status === 403 ? "full" : "failed");

export async function signInWithLine(): Promise<SignIn> {
  await setupLine();
  let idToken: string | undefined;
  try {
    const r = await Line.login({ scopes: [Scope.Profile, Scope.OpenId], botPrompt: BotPrompt.Normal }); // the add-friend choice, so results can reach the chat
    idToken = r.accessToken?.idToken;
  } catch (err) {
    return /cancel/i.test(String((err as Error)?.message)) ? "cancelled" : "failed";
  }
  if (!idToken) return "failed";
  const r = await api("POST", "/api/auth/line/native", { idToken });
  return result(r.status);
}

export const appleAvailable = () => (Platform.OS === "ios" ? AppleAuthentication.isAvailableAsync() : Promise.resolve(false));

export async function signInWithApple(): Promise<SignIn> {
  const nonce = Crypto.randomUUID();
  let cred: AppleAuthentication.AppleAuthenticationCredential;
  try {
    cred = await AppleAuthentication.signInAsync({
      requestedScopes: [], // Smith needs no name or email
      nonce: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce), // Apple puts this in the token; the server checks it against the raw one
    });
  } catch (err) {
    return (err as { code?: string })?.code === "ERR_REQUEST_CANCELED" ? "cancelled" : "failed";
  }
  if (!cred.identityToken) return "failed";
  const r = await api("POST", "/api/auth/apple", { identityToken: cred.identityToken, nonce, authorizationCode: cred.authorizationCode });
  return result(r.status);
}

export async function signOutOfLine() {
  await setupLine();
  await Line.logout().catch(() => {});
}
