import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// public/app.js is a plain browser script, so the pieces under test are cut out of it, as in answer-card.test.js.
const src = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const plain = (s) => String(s ?? "").replace(/\*\*(.+?)\*\*/gs, "$1");

test("what screen readers hear of the chat is Smith's last reply, without markdown", () => {
  const m = src.match(/\n {2}const talkSaid = (.+);\n/);
  assert.ok(m, "talkSaid found in public/app.js");
  const talkSaid = new Function("plain", `return ${m[1]};`)(plain);
  assert.equal(talkSaid([{ role: "user", text: "ไปญี่ปุ่นช่วงไหนดี" }, { role: "smith", text: "**ซากุระ** มี.ค.-เม.ย." }]), "Smith: ซากุระ มี.ค.-เม.ย.");
  assert.equal(talkSaid([{ role: "user", text: "q" }]), "");
  assert.equal(talkSaid([]), "");
});

test("the home screen has a way back to the chat", () => {
  const home = src.slice(src.indexOf("  function homeView() {"), src.indexOf("  // The composer is one line"));
  assert.match(home, /href="#\/talk"/);
});

test("the privacy policy says the chat is kept, and deleted with the account", () => {
  const from = src.indexOf("  const PRIVACY = [");
  const to = src.indexOf("  const TERMS = [");
  const privacy = new Function(`${src.slice(from, to)}; return PRIVACY;`)();
  const kept = privacy.find(([h]) => h === "ข้อมูลที่เราเก็บ")[1];
  assert.ok(kept.some((s) => s.includes("คุยกับ Smith")), "listed as kept");
  const deleted = privacy.find(([h]) => h === "เก็บนานแค่ไหน")[1][0];
  assert.match(deleted, /แชท/, "named among what deleting the account removes");
});
