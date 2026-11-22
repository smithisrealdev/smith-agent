import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// public/app.js is a plain browser script, so the answer card's code is cut out of it and run here with stand-ins.
const src = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const from = src.indexOf("  const LIST_LINE = ");
const to = src.indexOf("  // The chat under a result");
assert.ok(from > 0 && to > from, "answer card code found in public/app.js");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const answerCard = new Function("esc", "svg", "IC", `${src.slice(from, to)}; return answerCard;`)(esc, () => "<svg/>", { bold: { check: "", sparkle: "" } });
const card = (answer, options = []) => answerCard({ answer, options });

test("a lead-in line with list lines under it shows as a paragraph and a list", () => {
  const html = card("ตัวเลือกอื่น:\n• IKEA ฿1,290\n• JIB ฿990");
  assert.match(html, /<p[^>]*>ตัวเลือกอื่น:<\/p><ul class="answer-list" role="list"><li><svg\/><span>IKEA ฿1,290<\/span><\/li><li><svg\/><span>JIB ฿990<\/span><\/li><\/ul>/);
  assert.doesNotMatch(html, /•/);
});

test("numbered lines keep their order as a numbered list, without check marks", () => {
  const html = card("วิธีต่ออายุ\n1. จองคิว\n2. ไปสำนักงาน");
  assert.match(html, /<ol class="answer-list" role="list"><li><span>จองคิว<\/span><\/li><li><span>ไปสำนักงาน<\/span><\/li><\/ol>/);
  assert.doesNotMatch(html, /<ol[\s\S]*<svg/);
});

test("only a short opening paragraph reads as a headline, never a list", () => {
  assert.match(card("แนะนำ Hatari ฿748 ประกัน 3 ปี", [{}]), /<p class="lead">/);
  assert.doesNotMatch(card("- ข้อหนึ่ง\n- ข้อสอง"), /class="lead"/);
  assert.doesNotMatch(card("ก".repeat(200)), /class="lead"/);
});

test("the card is labelled by whether there are options, and escapes what the model wrote", () => {
  assert.match(card("x", [{}]), /Smith แนะนำ/);
  assert.match(card("x"), /สรุปจาก Smith/);
  const html = card('<img src=x onerror="alert(1)"> **ตัวหนา**');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; ตัวหนา/);
});
