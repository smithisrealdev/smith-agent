// Every tunable lives here; each one can be overridden from the environment.
const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || "").replace(/\/$/, ""), // https URL of this server, needed for evidence images in LINE
  dbPath: env.DB_PATH || "data/smith.db",
  evidenceDir: env.EVIDENCE_DIR || "data/evidence",
  lineSecret: env.LINE_CHANNEL_SECRET || "",
  lineToken: env.LINE_CHANNEL_ACCESS_TOKEN || "",
  model: env.SMITH_MODEL || "claude-opus-5-5",
  startCredit: Number(env.START_CREDIT || 20), // "first job free, up to ฿20" from the design
  usdThb: Number(env.USD_THB || 36),
};

// The price the user sees before a job starts, and the work budget that price buys.
export const SIZES = {
  S: { price: 5, minutes: 1, searches: 3, fetches: 2 },
  M: { price: 9, minutes: 3, searches: 6, fetches: 4 },
  L: { price: 15, minutes: 5, searches: 10, fetches: 6 },
};

// Auto-refund rules from the design: within 24 hours of the result, 3 times a month; the rest go to manual review.
export const REFUND = { windowHours: 24, autoPerMonth: 3 };

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
