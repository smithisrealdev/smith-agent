import { test } from "node:test";
import assert from "node:assert/strict";
import { costThb, quote, runTask } from "../src/agent.js";

// A stand-in for the SDK client that returns canned responses and records each request.
function fakeClient(...responses) {
  const calls = [];
  return { calls, beta: { messages: { create: async (params) => { calls.push(structuredClone(params)); return responses.shift(); } } } };
}
const usage = (extra = {}) => ({ input_tokens: 1000, output_tokens: 200, ...extra });
const toolUse = (name, input) => ({ type: "tool_use", id: "t1", name, input });

test("cost in baht follows list prices, including web searches", () => {
  assert.equal(costThb("claude-opus-5-5", { input_tokens: 1e6 }).toFixed(2), "144.00");
  const c = costThb("claude-opus-5-5", usage({ server_tool_use: { web_search_requests: 2 } }));
  assert.equal(c.toFixed(3), "1.008"); // ($0.004 + $0.004 + $0.02) x 36
  assert.equal(costThb("unknown-model", { output_tokens: 1e6 }).toFixed(0), "720", "unknown models are priced like the default");
});

test("quote asks once, at low effort, with refusal fallback, and reads the quote tool", async () => {
  const client = fakeClient({
    model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(),
    content: [toolUse("quote", { doable: true, reason: "", title: "หาตั๋ว", steps: ["a", "b"], size: "L" })],
  });
  const q = await quote("หาตั๋วไปเชียงใหม่", client);
  assert.equal(q.doable, true);
  assert.equal(q.size, "L");
  assert.ok(q.cost > 0);
  const p = client.calls[0];
  assert.equal(p.model, "claude-opus-5-5");
  assert.equal(p.output_config.effort, "low");
  assert.equal(p.fallbacks, "default");
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(p.tools[0].strict, true);
});

test("no quote tool call (for example a refusal) means the job is not taken", async () => {
  const client = fakeClient({ model: "claude-opus-5-5", stop_reason: "refusal", usage: usage(), content: [] });
  const q = await quote("...", client);
  assert.equal(q.doable, false);
  assert.ok(q.reason);
});

test("runTask resumes a paused server turn, then returns the report", async () => {
  const paused = { model: "claude-opus-5-5", stop_reason: "pause_turn", usage: usage({ server_tool_use: { web_search_requests: 3 } }), content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } }] };
  const report = {
    model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(),
    content: [
      { type: "text", text: "สรุป" },
      toolUse("report", {
        ok: true, answer: "เที่ยวเช้า ฿1,290", summary: "เจอแล้ว",
        sources: [{ title: "A", url: "https://a.example/x" }, { title: "bad", url: "javascript:alert(1)" }],
        best_url: "https://a.example/x",
      }),
    ],
  };
  const client = fakeClient(paused, report);
  const r = await runTask({ text: "หาตั๋ว", steps: JSON.stringify(["เปิดเว็บ"]), size: "S" }, client, new Date("2026-11-20T03:00:00Z"));
  assert.equal(r.ok, true);
  assert.equal(r.answer, "เที่ยวเช้า ฿1,290");
  assert.deepEqual(r.sources, [{ title: "A", url: "https://a.example/x" }], "non-web links are dropped");
  assert.equal(r.bestUrl, "https://a.example/x");
  assert.equal(r.usage.searches, 3);
  assert.equal(r.usage.input_tokens, 2000);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].messages.length, 2);
  assert.equal(client.calls[1].messages[1].role, "assistant");
  const tools = client.calls[0].tools;
  assert.equal(tools[0].type, "web_search_20260209");
  assert.equal(tools[0].max_uses, 3, "the S budget");
  assert.equal(tools[1].type, "web_fetch_20260209");
  assert.match(client.calls[0].messages[0].content, /วันนี้ 2026-11-20[\s\S]*1\. เปิดเว็บ/);
});

test("runTask fails without a charge when the agent reports it could not finish, or never reports", async () => {
  const notFound = fakeClient({ model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(), content: [toolUse("report", { ok: false, answer: "", summary: "ไม่เจอข้อมูล", sources: [], best_url: "" })] });
  const r1 = await runTask({ text: "x", steps: "[]", size: "M" }, notFound);
  assert.equal(r1.ok, false);
  assert.equal(r1.error, "ไม่เจอข้อมูล");
  const silent = fakeClient({ model: "claude-opus-5-5", stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "..." }] });
  const r2 = await runTask({ text: "x", steps: "[]", size: "M" }, silent);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /no report \(end_turn\)/);
});

test("runTask stops after 5 paused turns", async () => {
  const paused = () => ({ model: "claude-opus-5-5", stop_reason: "pause_turn", usage: usage(), content: [] });
  const client = fakeClient(paused(), paused(), paused(), paused(), paused());
  const r = await runTask({ text: "x", steps: "[]", size: "M" }, client);
  assert.equal(r.ok, false);
  assert.equal(r.error, "too many pauses");
  assert.equal(client.calls.length, 5);
});
