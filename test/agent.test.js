import { test } from "node:test";
import assert from "node:assert/strict";
import { costThb, quote, runTask, stepOf, cleanCodes, modelId, webTools, chat, talk } from "../src/agent.js";
import { SIZES, config, REFUND } from "../src/config.js";

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
          const events = [];
          return {
            on: (event, cb) => (event === "contentBlock" ? handlers.push(cb) : event === "streamEvent" && events.push(cb)),
            finalMessage: async () => {
              for (const block of res.content) handlers.forEach((h) => h(block));
              if (res.charged !== undefined) events.forEach((h) => h({ type: "message_delta", usage: { cost: res.charged } })); // OpenRouter's real charge, as in its stream
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
  const pages = [];
  await runTask({ text: "x", steps: "[]", size: "S" }, fakeClient(paused, report), new Date(), (s, url) => (steps.push(s), pages.push(url)));
  assert.deepEqual(pages, ["", "https://www.airline-a.example/fares", ""], "a page read also names its page, for the site's logo");
  assert.deepEqual(steps, ['ค้นหา "ตั๋ว เชียงใหม่ ศุกร์"', "เปิดอ่าน airline-a.example", "สรุปผล"]);
  assert.equal(stepOf({ type: "server_tool_use", name: "web_fetch", input: { url: "not a url" } }), null);
  assert.equal(stepOf({ type: "server_tool_use", name: "web_search", input: {} }), null, "no query yet");
});

test("options come back as at most 3 cards, and a bad link is dropped from its card", async () => {
  const opt = (name, url, brand_site = "") => ({ name, price: "฿1,290", note: "บินตรง", url, brand_site });
  const report = {
    model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(),
    content: [toolUse("report", { ok: true, answer: "a", summary: "s", sources: [], best_url: "", options: [opt("A", "https://www.a.example/x"), opt("B", "javascript:alert(1)", "evil/../x"), opt("C", "https://travel.example/c", "AirAsia.com"), opt("D", "https://d.example")] })],
  };
  const r = await runTask({ text: "x", steps: "[]", size: "M" }, fakeClient(report));
  assert.deepEqual(r.options.map((o) => [o.name, o.url]), [["A", "https://www.a.example/x"], ["B", ""], ["C", "https://travel.example/c"]]);
  assert.deepEqual(r.options.map((o) => o.brand), ["a.example", "", "airasia.com"], "the logo is the brand's when the agent names it, else the page's site");
  assert.equal("brand_site" in r.options[0], false);
});

test("what the agent opened is counted from the stream: pages read, sites read, and sites it could not read", async () => {
  const fetch = (id, url) => ({ type: "server_tool_use", id, name: "web_fetch", input: { url } });
  const result = (id, content) => ({ type: "web_fetch_tool_result", tool_use_id: id, content });
  const paused = {
    model: "claude-opus-5-5", stop_reason: "pause_turn", usage: usage({ server_tool_use: { web_search_requests: 3 } }),
    content: [
      fetch("f1", "https://www.shop-a.example/p/1"), result("f1", { type: "web_fetch_result", url: "x" }),
      fetch("f2", "https://shop-a.example/p/2"), result("f2", { type: "web_fetch_result", url: "x" }),
      fetch("f3", "https://shopee.example/item"), result("f3", { type: "web_fetch_tool_error", error_code: "url_not_accessible" }),
      fetch("f4", "https://mixed.example/a"), result("f4", { type: "web_fetch_tool_error", error_code: "unavailable" }),
      fetch("f5", "https://mixed.example/b"), result("f5", { type: "web_fetch_result", url: "x" }),
    ],
  };
  const report = { model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(), content: [toolUse("report", { ok: true, answer: "a", summary: "s", sources: [], best_url: "", options: [], codes: [] })] };
  const r = await runTask({ text: "x", steps: "[]", size: "M" }, fakeClient(paused, report));
  assert.deepEqual(r.coverage, { searches: 3, pages: 3, hosts: ["shop-a.example", "mixed.example"], blocked: ["shopee.example"] }, "a site read at least once is not listed as unreadable");
  const silent = await runTask({ text: "x", steps: "[]", size: "M" }, fakeClient({ model: "claude-opus-5-5", stop_reason: "end_turn", usage: usage(), content: [fetch("f1", "https://shopee.example/x"), result("f1", { type: "web_fetch_tool_error" })] }));
  assert.equal(silent.ok, false);
  assert.deepEqual(silent.coverage.blocked, ["shopee.example"], "a job that fails still tells which site was out of reach");
});

test("a discount code is kept only if it looks like one and names the page where it was seen", () => {
  const c = (code, url = "https://shop.example/promo", extra = {}) => ({ code, shop: "ร้าน A", note: "ลด 10%", url, ...extra });
  const got = cleanCodes([
    c("SAVE10"), c("save10"), c("ใช้โค้ด SAVE20"), c("AB"), c("X".repeat(33)), c("NOLINK", ""), c("BADLINK", "javascript:alert(1)"),
    c("WELCOME_5"), c("ลด50", "https://shop.example/x"), c("FOUR4"), c("FIVE5"),
  ]);
  assert.deepEqual(got.map((x) => x.code), ["SAVE10", "WELCOME_5", "ลด50"], "no repeats, no spaces, no code without a page, at most 3");
  assert.deepEqual(cleanCodes(undefined), []);
  assert.deepEqual(cleanCodes([{ code: "SAVE10", url: "https://a.example", shop: "S".repeat(100), note: "n".repeat(300) }])[0].shop.length, 60);
});

test("runTask returns the cleaned codes from the report", async () => {
  const report = { model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(), content: [toolUse("report", { ok: true, answer: "a", summary: "s", sources: [], best_url: "", options: [], codes: [{ code: "SAVE10", shop: "ร้าน A", note: "ลด 10%", url: "https://a.example/promo" }, { code: "bad code", shop: "", note: "", url: "https://a.example" }] })] };
  const r = await runTask({ text: "x", steps: "[]", size: "M" }, fakeClient(report));
  assert.deepEqual(r.codes.map((c) => c.code), ["SAVE10"]);
});

test("through OpenRouter, models get OpenRouter's names and are still priced from the same table", () => {
  assert.equal(modelId("claude-opus-5-5", true), "anthropic/claude-opus-5.5");
  assert.equal(modelId("claude-haiku-5-5", true), "anthropic/claude-haiku-5.5");
  assert.equal(modelId("anthropic/claude-sonnet-5.5", true), "anthropic/claude-sonnet-5.5", "a full OpenRouter id passes through");
  assert.equal(modelId("claude-opus-5-5", false), "claude-opus-5-5");
  assert.equal(costThb("anthropic/claude-sonnet-5.5", { input_tokens: 1e6 }).toFixed(2), costThb("claude-sonnet-5-5", { input_tokens: 1e6 }).toFixed(2));
});

test("a model through OpenRouter: the real charge comes from usage.cost, and OpenRouter's tool names still show as steps and pages", async () => {
  assert.equal(costThb("deepseek/deepseek-v4-flash", { cost: 0.01, input_tokens: 1e6 }).toFixed(2), "0.36", "usage.cost (USD) wins over the price table");
  assert.equal(stepOf({ type: "server_tool_use", name: "openrouter:web_search", input: { query: "q" } }), 'ค้นหา "q"');
  assert.equal(stepOf({ type: "server_tool_use", name: "openrouter:web_fetch", input: { url: "https://jib.co.th/p" } }), "เปิดอ่าน jib.co.th");
  const fetch = (id, url) => ({ type: "server_tool_use", id, name: "openrouter:web_fetch", input: { url } });
  const res = { model: "deepseek/deepseek-v4-flash", stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1, cost: 0.02 },
    content: [fetch("f1", "https://www.jib.co.th/a"), fetch("f2", "https://jib.co.th/b"), toolUse("report", { ok: true, answer: "a", summary: "s", sources: [], best_url: "", options: [], codes: [] })] };
  const r = await runTask({ text: "x", steps: "[]", size: "M" }, fakeClient(res));
  assert.deepEqual(r.coverage, { searches: 0, pages: 2, hosts: ["jib.co.th"], blocked: [] }, "no results come back, so each page asked for counts as read");
  assert.equal(r.usage.cost.toFixed(2), "0.72");
});

test("Claude gets Anthropic's search tools; any other model gets OpenRouter's, with the size's budget", () => {
  const M = { searches: 6, fetches: 4 };
  for (const m of ["claude-opus-5-5", "anthropic/claude-sonnet-5.5"]) assert.deepEqual(webTools(m, M).map((t) => [t.type, t.max_uses]), [["web_search_20260209", 6], ["web_fetch_20260209", 4]]);
  assert.deepEqual(webTools("z-ai/glm-5.3", M).map((t) => [t.type, t.parameters.max_uses]), [["openrouter:web_search", 6], ["openrouter:web_fetch", 4]]);
});

test("a streamed job through OpenRouter is charged what OpenRouter says (from the stream), not what a Claude price table would say", async () => {
  const report = { model: "z-ai/glm-5.3", stop_reason: "tool_use", usage: usage({ input_tokens: 3000, output_tokens: 800 }), charged: 0.02, content: [toolUse("report", { ok: true, answer: "a", summary: "s", sources: [], best_url: "", options: [], codes: [] })] };
  const r = await runTask({ text: "x", steps: "[]", size: "M" }, fakeClient(report));
  assert.equal(r.usage.cost.toFixed(2), "0.72", "$0.02 at 36 baht, however many tokens");
  const plain = await runTask({ text: "x", steps: "[]", size: "M" }, fakeClient({ ...report, charged: undefined, model: "claude-opus-5-5" }));
  assert.ok(plain.usage.cost > 0, "with no stated charge (Anthropic direct) the list prices still apply");
});

const DONE = { text: "หาหูฟัง", answer: "ร้าน B ถูกสุด", options: JSON.stringify([{ name: "B", price: "฿8,990", note: "", url: "https://b.example/x" }]), codes: "[]", sources: "[]", chat: JSON.stringify([{ role: "user", text: "ถามก่อนหน้า" }]) };
const reply = (input) => ({ model: "claude-opus-5-5", usage: usage(), content: input ? [toolUse("reply", input)] : [] });

test("chat answers from the result in one low-effort call, a search carries a plan, and no tool call is a plain answer", async () => {
  const client = fakeClient(
    reply({ kind: "answer", text: "ร้าน B ส่งฟรี", title: "", steps: [], size: "S" }),
    reply({ kind: "search", text: "จะค้นร้านที่ถูกกว่า", title: "หาหูฟังถูกกว่า", steps: ["ค้น 3 ร้าน"], size: "X" }),
    reply(null),
    reply(null),
  );
  const a = await chat(DONE, "ร้านไหนส่งฟรี", client);
  assert.deepEqual([a.kind, a.text], ["answer", "ร้าน B ส่งฟรี"]);
  assert.ok(a.cost > 0);
  assert.equal(client.calls[0].output_config.effort, "low");
  const sent = JSON.stringify(client.calls[0].messages);
  for (const s of ["หาหูฟัง", "ร้าน B ถูกสุด", "b.example/x", "ถามก่อนหน้า", "ร้านไหนส่งฟรี"]) assert.ok(sent.includes(s), `the model sees ${s}`);
  const b = await chat(DONE, "หาถูกกว่านี้", client);
  assert.deepEqual([b.kind, b.title, b.size], ["search", "หาหูฟังถูกกว่า", "M"], "an unknown size falls back to M");
  const none = await chat(DONE, "?", client);
  assert.deepEqual([none.kind, none.text], ["answer", "Smith ยังไม่เข้าใจ ลองพิมพ์ใหม่อีกนิด"], "no tool call, even when asked again, is never a search");
  assert.equal(client.calls.length, 4, "asked once more before giving up");
});

test("chat asks once more when the model ends without the reply tool, and uses plain text it wrote", async () => {
  const noTool = { model: "claude-opus-5-5", stop_reason: "max_tokens", usage: usage(), content: [{ type: "thinking", thinking: "..." }] };
  const retried = fakeClient(noTool, reply({ kind: "answer", text: "HAN RIVER 8 ลิตร จุเยอะสุด", title: "", steps: [], size: "S" }));
  const a = await chat(DONE, "อันไหนจุเยอะสุด", retried);
  assert.deepEqual([a.kind, a.text, retried.calls.length], ["answer", "HAN RIVER 8 ลิตร จุเยอะสุด", 2]);
  const plain = { model: "claude-opus-5-5", stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: " ร้าน B ส่งฟรีครับ " }] };
  const b = await chat(DONE, "ร้านไหนส่งฟรี", fakeClient(plain, plain));
  assert.deepEqual([b.kind, b.text], ["answer", "ร้าน B ส่งฟรีครับ"], "plain text from the model is still an answer");
  assert.ok(b.cost > costThb("claude-opus-5-5", usage()), "both calls are paid for");
});

test("a re-search run sees the previous round's result", async () => {
  const client = fakeClient({ model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(), content: [toolUse("report", { ok: true, answer: "a", summary: "s", sources: [], best_url: "", options: [], codes: [] })] });
  await runTask({ text: "หาหูฟัง\n\nรอบนี้: สีดำ", steps: "[]", size: "M" }, client, new Date(), () => {}, undefined, DONE);
  const sent = JSON.stringify(client.calls[0].messages);
  assert.ok(sent.includes("ร้าน B ถูกสุด") && sent.includes("b.example/x"));
});

test("shopping in Thailand: the prompts send the agent to Shopee, Lazada and a price-comparison site", async () => {
  const run = fakeClient({ model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(), content: [toolUse("report", { ok: true, answer: "a", summary: "s", sources: [], best_url: "", options: [], codes: [] })] });
  await runTask({ text: "หาหูฟัง", steps: "[]", size: "M" }, run);
  for (const name of ["Shopee", "Lazada", "priceza.com"]) assert.ok(run.calls[0].system.includes(name), `the run prompt names ${name}`);
  for (const rule of ["not travel, tickets or services", "unless the user names the shops", "never rank a price from a search result above"]) assert.ok(run.calls[0].system.includes(rule), rule);
  const q = fakeClient({ model: "claude-opus-5-5", usage: usage(), content: [toolUse("quote", { doable: true, reason: "", title: "t", steps: ["s"], size: "M" })] });
  await quote("หาหูฟัง", q);
  for (const name of ["Shopee", "Lazada", "unless the user names the shops"]) assert.ok(q.calls[0].system.includes(name), `the plan says ${name}`);
});

test("the run prompt keeps answers with options to 2 sentences, without emoji", async () => {
  const client = fakeClient({ model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(), content: [toolUse("report", { ok: true, answer: "a", summary: "s", sources: [], best_url: "", options: [], codes: [] })] });
  await runTask({ text: "หาหูฟัง", steps: "[]", size: "M" }, client);
  for (const rule of ["at most 2 short sentences", "No emoji", "no markdown"]) assert.ok(client.calls[0].system.includes(rule), rule);
});

test("chat replies are plain text: the prompt rules out markdown", async () => {
  const client = fakeClient(reply({ kind: "answer", text: "ok", title: "", steps: [], size: "S" }));
  await chat(DONE, "?", client);
  assert.ok(client.calls[0].system.includes("no markdown"));
});

// ---------- chat before a job
const PAST = [{ role: "user", text: "สวัสดี" }, { role: "smith", text: "สวัสดีครับ" }];
const said = (input) => reply({ task: "", title: "", steps: [], size: "S", ...input });

test("talk sends the recent chat and the new message in one low-effort call with only the reply tool, and returns an answer", async () => {
  const client = fakeClient(said({ kind: "answer", text: "ผมช่วยค้นและเทียบข้อมูลจากเว็บให้ครับ" }));
  const r = await talk(PAST, "ทำไรได้บ้าง", client);
  assert.deepEqual([r.kind, r.text], ["answer", "ผมช่วยค้นและเทียบข้อมูลจากเว็บให้ครับ"]);
  assert.ok(r.cost > 0);
  const call = client.calls[0];
  assert.deepEqual(call.tools.map((t) => t.name), ["reply"], "no web tools: free chat cannot search");
  assert.equal(call.output_config.effort, "low");
  assert.match(call.messages[0].content, /ผู้ใช้: สวัสดี[\s\S]*Smith: สวัสดีครับ[\s\S]*ทำไรได้บ้าง/);
});

test("talk turns a job into a quote for the full request", async () => {
  const client = fakeClient(
    said({ kind: "task", text: "หาให้ได้ครับ", task: "หาหูฟังตัดเสียง งบไม่เกิน 3,000 บาท", title: "หาหูฟังตัดเสียง", steps: ["ค้น Shopee", "เทียบราคา"], size: "M" }),
    said({ kind: "task", text: "ได้ครับ", task: "", title: "", steps: ["ค้น"], size: "X" }),
  );
  const r = await talk(PAST, "ไม่เกิน 3,000", client);
  assert.deepEqual({ kind: r.kind, doable: r.doable, reason: r.reason, task: r.task, title: r.title, size: r.size }, { kind: "task", doable: true, reason: "", task: "หาหูฟังตัดเสียง งบไม่เกิน 3,000 บาท", title: "หาหูฟังตัดเสียง", size: "M" });
  const bare = await talk([], "หาตั๋วไปเชียงใหม่ศุกร์นี้ ถูกสุดแบบไม่มีกระเป๋า", client);
  assert.equal(bare.task, "หาตั๋วไปเชียงใหม่ศุกร์นี้ ถูกสุดแบบไม่มีกระเป๋า", "an empty task falls back to the user's text");
  assert.equal(bare.title, "หาตั๋วไปเชียงใหม่ศุกร์นี้ ถูกสุดแบบไม่มีกระเป๋า".slice(0, 40));
  assert.equal(bare.size, "M", "an unknown size falls back to M");
});

test("talk asks once more when the model skips the tool, then answers with the plain text it wrote, never a job", async () => {
  const plain = (text) => ({ model: "claude-opus-5-5", stop_reason: "end_turn", usage: usage(), content: text ? [{ type: "text", text }] : [] });
  const client = fakeClient(plain(""), plain(" สวัสดีครับ "));
  const r = await talk([], "หวัดดี", client);
  assert.deepEqual([r.kind, r.text, client.calls.length], ["answer", "สวัสดีครับ", 2]);
  const silent = await talk([], "หวัดดี", fakeClient(plain(""), plain("")));
  assert.equal(silent.kind, "answer");
  assert.ok(silent.text.length > 0, "a gentle line when the model said nothing");
});

test("the talk prompt names the prices, the note on AI knowledge, and current facts as jobs", async () => {
  const client = fakeClient(said({ kind: "answer", text: "ok" }));
  await talk([], "?", client);
  const sys = client.calls[0].system;
  for (const s of [`฿${SIZES.S.price}`, `฿${SIZES.M.price}`, `฿${SIZES.L.price}`, "(จากความรู้ของ AI ไม่มีลิงก์ยืนยัน)", "from memory", "Shopee", "no markdown"]) assert.ok(sys.includes(s), `the prompt says ${s}`);
});

test("the talk prompt gives the money facts, keeps the model from guessing a balance, and leaves the price to the card", async () => {
  const client = fakeClient(said({ kind: "answer", text: "ok" }));
  await talk([], "เติมเงินยังไง", client);
  const sys = client.calls[0].system;
  for (const s of [`A new account starts with ฿${config.startCredit} credit`, "เครดิต", "never state a balance", "help page", `within ${REFUND.windowHours} hours`, "2 or 3 example jobs", "do not repeat them"]) assert.ok(sys.includes(s), `the prompt says ${s}`);
});
