// The chat before a job (the app's order box and LINE), with one set of rules for both: a free answer, or a quoted job
// that is charged only when the user taps start.
export const TALK_MAX = 1000; // characters, as the order box allows
// The model reads only this recent part of the chat: an old budget or "this Friday" must not slip into a new paid job.
const RECENT_MS = 3 * 3600e3;

export function createTalk({ store, talk, full, perHour = 30, now = () => new Date() }) {
  // People with a reply on its way. One at a time per person: the limits are read before the paid model call, so parallel
  // messages (LINE and the app, two tabs, a script) would otherwise all get through.
  const busy = new Set();

  // Returns { error } with a code the caller shows (text, rate, busy, talk_busy), or { reply, job } once saved, where
  // `job` is the quoted job when the message was a job and null otherwise.
  async function say(userId, raw) {
    const text = String(raw ?? "").trim();
    if (!text || text.length > TALK_MAX) return { error: "text" };
    if (store.talksSince(userId, new Date(now() - 3600e3).toISOString()) >= perHour) return { error: "rate" };
    if (full()) return { error: "busy" };
    if (busy.has(userId)) return { error: "talk_busy" };
    busy.add(userId);
    try {
      const reply = await talk(store.talkOf(userId).filter((e) => Date.parse(e.at) >= now() - RECENT_MS), text);
      store.user(userId);
      const job = reply.kind === "task" ? store.addQuote(userId, reply.task, reply) : null;
      // A job's cost is its quote_cost already, so only a free answer's cost goes on the chat row.
      store.addTalk(userId, [{ role: "user", text }, { role: "smith", text: reply.text, job: job?.id }], job ? 0 : reply.cost);
      return { reply, job };
    } finally {
      busy.delete(userId);
    }
  }

  return { say };
}
