# Smith native app (Expo) — design

Approved by the founder in chat on 2026-11-22 ("โอเค", then "implement code เลย").

## Why
The founder wants Smith on the App Store and Google Play as a real app, not a website, with smooth, rich motion.
The app replaces the PWA as the phone experience; the PWA in `public/` stays for desktop and as the PromptPay path.

## Goals
- Expo (React Native, New Architecture) app in `mobile/`, same `/api/*` endpoints as `public/app.js`, Bearer device token.
- Every screen of the web app: welcome/consent, sign-in, home (order box, templates), talk (`/api/talk`), quote,
  live job (pictures, take-over), result (answer card, options, evidence, chat under results, free re-search),
  history, wallet, refund, settings, help, privacy/terms, delete account.
- Same look as the web app (founder's choice): colours, Prompt/Mitr fonts, cards, icons and the elephant from
  `public/app.css`, `icons.js`, `mascots.js`. Motion added: native screen transitions, press scale + haptics,
  steps appearing one by one, live picture cross-fade, Lottie success, mascot blink/ears/bounce, all reduced when
  the phone asks for reduced motion.
- Server: native LINE Login, Sign in with Apple (iOS), in-app credit packs verified on the server, Expo push when a job ends.

## Non-goals (v1)
- Linking an Apple account to a LINE account (separate accounts). Rive. Removing the PWA.
- Automatic credit removal on a store refund (the founder is alerted on LINE and acts by hand).

## Anti-goals
- Any PromptPay number, link or wording in the app (store rule). Credit added without a verified receipt,
  or twice for one receipt.

## Decisions
- Credit packs, consumable, same on both stores: `credit_50` ฿59 → ฿50, `credit_100` ฿119 → ฿100,
  `credit_250` ฿299 → ฿250. The server owns the product → credit map and sends it in `/api/me` as `packs`.
- Sign-in: Android LINE only; iOS LINE + Apple. Apple users are `apple:<sub>` and get results by push.
- Push: Expo push service (`https://exp.host/--/api/v2/push/send`, plain fetch), on job done or failed.
  LINE users still get their LINE message.
- Take-over opens the page in an in-app browser (`expo-web-browser`).
- Bundle / package id `com.smithagent.app` until the first submission. Server URL set at build time (`EXPO_PUBLIC_API_URL`).

## Approaches considered
- **Expo + Expo Router + EAS development build (picked).** Matches the founder's libraries; LINE SDK and IAP need
  native code so Expo Go is out.
- WebView wrapper of the PWA: not a real app, likely rejected under Apple 4.2.
- Bare React Native CLI: more work, nothing gained.

## Server design (Node 22, no new dependencies)
- `POST /api/auth/line/native {idToken}` → LINE `/oauth2/v2.1/verify` with the Login channel id → `sub` →
  `store.signIn(key, sub)`. Same user id as the bot (one provider).
- `POST /api/auth/apple {identityToken, nonce, authorizationCode?}` → verify the RS256 JWT against Apple's JWKS
  (`node:crypto`, JWK keys), `iss`, `aud` = bundle id, `exp`, `nonce` = sha256(raw nonce) → `apple:<sub>`.
  Account deletion of an Apple user revokes its token when an Apple key is configured (guideline 5.1.1(v)).
- Sessions are required whenever LINE Login or Apple is on.
- `POST /api/purchase {platform, productId, receipt}`:
  - iOS: StoreKit 2 signed transaction (JWS). Verify the x5c chain up to Apple Root CA G3 (bundled) with
    `X509Certificate`, the ES256 signature, `bundleId`, `productId`, then credit.
  - Android: Play Developer API `purchases.products.get` with a service-account token (RS256 JWT signed with
    `node:crypto`), purchaseState 0, then consume.
  - New table `purchases (platform, transaction_id UNIQUE, user_id, product_id, amount, created_at)` and ledger kind
    `purchase`, written in one transaction, so a resent receipt adds nothing.
- `POST /api/push {token}` stores an Expo push token per user; `deleteUser` removes it.
- Store notifications (`/iap/apple/notify`, `/iap/google/notify`) only alert the founder on refunds.

## App design
- Expo Router file routes in `mobile/app/`, one per web route. `mobile/src/api.js` mirrors the fetch helper of
  `public/app.js`; the token lives in `expo-secure-store`.
- Polling every 2 s on a running job, like the web app.
- Mascot: the SVG parts from `mascots.js` as `react-native-svg` components, animated with Reanimated.

## Left to the builder
File layout inside `mobile/`, component split, exact motion timings (start from the web's `--press 80ms`, `--base 200ms`).

## Needs the founder (not code)
Apple Developer + Google Play accounts, App Store Connect products, Sign in with Apple capability, APNs/FCM keys on EAS,
Play service account, a permanent server URL (domain), store listings and submission.

## What changed while building (2026-11-22)
- **Nativewind / React Native Reusables dropped.** The only Nativewind for Expo SDK 58 is 5.0 RC; its import rewriting removed
  `AssetRegistry` from `react-native`, so fonts and images failed to load on iOS. Styles are plain React Native with the web
  app's tokens (`mobile/src/ui/theme.ts`, `kit.tsx`). Reusables needs Nativewind, so it went too.
- **Not used yet:** Lottie (no animation file; the finish uses the "done" mascot, hearts and a Reanimated star burst), Skia, Reacticx.
- **Read aloud** (web `speechSynthesis`) not ported: expo-speech is not installed.
- **Notifications** are asked for when the first job starts, not on first launch.
- **LINE SDK plugin** does not support Expo SDK 58's AppDelegate/SceneDelegate: `mobile/plugins/with-line.js` replaces it.
- Apple Root CA G3 fingerprint in `src/iap.js` checked against the macOS system root store.
