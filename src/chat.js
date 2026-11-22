// The chat under a finished job, shared by the web app and the LINE bot, so both keep the same rules and one guard.
export const CHAT_LIMIT = 10; // questions per job: each answer is a paid model call

export function createChat({ store, chat, full, now = () => new Date() }) {
  // Jobs with an answer on its way. One at a time per job: the question cap and the daily cost cap are read before
  // the paid model call, so parallel requests (two tabs, LINE and the app, a script) would otherwise all get through.
  const chatting = new Set();
  const asked = (j) => JSON.parse(j.chat || "[]").filter((e) => e.role === "user").length;

  // An answer from what Smith found, or a re-search card that waits for a tap. Returns { error } with a code the
  // caller shows (status, text, limit, busy, chat_busy), or { job, reply, kid } once the answer is saved.
  async function ask(jobId, raw) {
    const text = String(raw ?? "").trim();
    const j = store.job(jobId);
    if (!j || !["done", "refunded", "refund_review"].includes(j.status)) return { error: "status" };
    if (!text || text.length > 500) return { error: "text" };
    if (asked(j) >= CHAT_LIMIT) return { error: "limit" };
    if (full()) return { error: "busy" };
    if (chatting.has(jobId)) return { error: "chat_busy" };
    chatting.add(jobId);
    try {
      const reply = await chat(j, text);
      const kid = reply.kind === "search" ? store.addFollowUp(jobId, `${j.text}\n\nรอบนี้: ${text}`, reply) : null;
      const at = now().toISOString();
      const job = store.addChat(jobId, [{ role: "user", text, at }, { role: "smith", text: reply.text, at, ...(kid && { job: kid.id }) }], reply.cost);
      return { job, reply, kid };
    } finally {
      chatting.delete(jobId);
    }
  }

  return { ask, left: (j) => CHAT_LIMIT - asked(j) };
}
