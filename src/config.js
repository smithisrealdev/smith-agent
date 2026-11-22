// Every tunable lives here; each one can be overridden from the environment.
const env = process.env;

// A secret that guards the staff download of the database. Too short to be safe is refused, not accepted quietly.
function adminToken(raw = "") {
  if (raw && raw.length < 32) throw new Error("ADMIN_TOKEN must be at least 32 characters (try: openssl rand -hex 32)");
  return raw;
}

// A whole number of baht from the environment, or the default. A typo stops the server at start instead of
// quietly charging a different price than the one intended.
function whole(name, fallback, min = 1) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number of at least ${min} (baht), got "${raw}"`);
  return n;
}

export const config = {
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || "").replace(/\/$/, ""), // https URL of this server (Render sets its own), for LINE images and LINE Login
  dbPath: env.DB_PATH || "data/smith.db",
  evidenceDir: env.EVIDENCE_DIR || "data/evidence",
  lineSecret: env.LINE_CHANNEL_SECRET || "",
  lineToken: env.LINE_CHANNEL_ACCESS_TOKEN || "",
  lineLoginId: env.LINE_LOGIN_CHANNEL_ID || "", // with its secret and PUBLIC_URL, the web app requires signing in with LINE
  lineLoginSecret: env.LINE_LOGIN_CHANNEL_SECRET || "",
  model: env.SMITH_MODEL || "claude-opus-5-5",
  usdThb: Number(env.USD_THB || 36),
  inviteCode: env.WEB_INVITE_CODE || "", // set it before the web app is reachable from the internet
  quotesPerHour: Number(env.QUOTES_PER_HOUR || 30), // per user; every quote is a paid Claude call
  adminToken: adminToken(env.ADMIN_TOKEN), // turns on GET /admin/backup; leave empty to keep that route off
  dailyCostCap: whole("DAILY_COST_CAP", 500, 0), // baht of Claude cost per Thai day, all users together; 0 turns the cap off
  linePushQuota: whole("LINE_PUSH_QUOTA", 300, 0), // pushes a month on your LINE OA plan (free plan in Thailand: 300); stats warns near it
  maxUsers: whole("MAX_USERS", 0, 0), // accounts allowed in the test round (the invite code is shared, so it caps nothing); 0 = no limit
  // Manual top-up by PromptPay: users transfer, tap "โอนแล้ว", and staff approve after checking the bank app. Off when empty.
  topup: env.TOPUP_PROMPTPAY ? { promptpay: env.TOPUP_PROMPTPAY, name: env.TOPUP_NAME || "", amount: whole("TOPUP_AMOUNT", 50) } : null,
};

// The price the user sees before a job starts, and the work budget that price buys.
// The prices can be changed with PRICE_S, PRICE_M and PRICE_L (whole baht); the work budget cannot.
export const SIZES = {
  S: { price: whole("PRICE_S", 5), minutes: 1, searches: 3, fetches: 2 },
  M: { price: whole("PRICE_M", 9), minutes: 3, searches: 6, fetches: 4 },
  L: { price: whole("PRICE_L", 15), minutes: 5, searches: 10, fetches: 6 },
};
// A bigger job must never cost less than a smaller one.
if (!(SIZES.S.price <= SIZES.M.price && SIZES.M.price <= SIZES.L.price)) {
  throw new Error(`PRICE_S, PRICE_M and PRICE_L must not go down with size, got ${SIZES.S.price} / ${SIZES.M.price} / ${SIZES.L.price}`);
}
// Trial credit: three medium jobs by default (founder/pricing.md), so it follows the price when PRICE_M changes.
config.startCredit = whole("START_CREDIT", 3 * SIZES.M.price, 0);

// Auto-refund rules from the design: within 24 hours of the result, 3 times a month; the rest go to manual review.
// "The price is not what the page shows" is Smith's own mistake, so it has its own, larger allowance.
export const REFUND = { windowHours: 24, autoPerMonth: 3, priceAutoPerMonth: 5, priceReason: "ราคาไม่ตรงกับหน้าเว็บ" };

// List prices in USD per million tokens [input, output, cache read], Nov 2026. Web search is $10 per 1,000 searches.
export const MODEL_PRICES = {
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-opus-4-8": [5, 25, 0.5],
};
export const SEARCH_USD = 0.01;

// Share of the list price left after Thai VAT (7%) and a 15% app-store fee, for the margin line in stats.
export const STORE_NET_RATE = 0.85 / 1.07;
