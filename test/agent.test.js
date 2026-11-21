import { test } from "node:test";
import assert from "node:assert/strict";
import { costThb, quote, runTask, stepOf } from "../src/agent.js";

// A stand-in for the SDK client that returns canned responses and records each request.
function fakeClient(...responses) {
  const calls = [];
  const next = (params) => {
    calls.push(structuredClone(params));
    return responses.shift();
  };
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => next(params),
        // Like the SDK's stream: each finished content block fires "contentBlock", then the whole message resolves.
        stream: (params) => {
          const res = next(params);
          const handlers = [];
          return {
            on: (event, cb) => event === "contentBlock" && handlers.push(cb),
            finalMessage: async () => {
              for (const block of res.content) handlers.forEach((h) => h(block));
              return res;
            },
          };
        },
      },
    },
  };
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

test("while it runs, each search, page read and the final report becomes a step the user can see", async () => {
  const paused = {
    model: "claude-opus-5-5", stop_reason: "pause_turn", usage: usage(),
    content: [
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "ตั๋ว เชียงใหม่ ศุกร์" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
      { type: "server_tool_use", id: "s2", name: "web_fetch", input: { url: "https://www.airline-a.example/fares" } },
      { type: "text", text: "..." },
    ],
  };
  const report = { model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(), content: [toolUse("report", { ok: true, answer: "a", summary: "s", sources: [], best_url: "", options: [] })] };
  const steps = [];
  await runTask({ text: "x", steps: "[]", size: "S" }, fakeClient(paused, report), new Date(), (s) => steps.push(s));
  assert.deepEqual(steps, ['ค้นหา "ตั๋ว เชียงใหม่ ศุกร์"', "เปิดอ่าน airline-a.example", "สรุปผล"]);
  assert.equal(stepOf({ type: "server_tool_use", name: "web_fetch", input: { url: "not a url" } }), null);
  assert.equal(stepOf({ type: "server_tool_use", name: "web_search", input: {} }), null, "no query yet");
});

test("options come back as at most 3 cards, and a bad link is dropped from its card", async () => {
  const opt = (name, url) => ({ name, price: "฿1,290", note: "บินตรง", url });
  const report = {
    model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(),
    content: [toolUse("report", { ok: true, answer: "a", summary: "s", sources: [], best_url: "", options: [opt("A", "https://a.example/x"), opt("B", "javascript:alert(1)"), opt("C", "https://c.example"), opt("D", "https://d.example")] })],
  };
  const r = await runTask({ text: "x", steps: "[]", size: "M" }, fakeClient(report));
  assert.deepEqual(r.options.map((o) => [o.name, o.url]), [["A", "https://a.example/x"], ["B", ""], ["C", "https://c.example"]]);
});
