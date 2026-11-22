import { test } from "node:test";
import assert from "node:assert/strict";
import { answerRuns, baht, duration, kindOf, shareText, when, brandOf } from "../src/lib/format.ts";

test("money, time and kinds read as on the web app", () => {
  assert.equal(baht(1250), "฿1,250");
  assert.equal(baht(null), "฿0");
  assert.equal(duration("2026-11-22T10:00:00Z", "2026-11-22T10:01:05Z"), "1 นาที 5 วินาที");
  assert.equal(duration("2026-11-22T10:00:00Z", "2026-11-22T10:00:37Z"), "37 วินาที");
  const now = Date.parse("2026-11-22T10:30:00Z");
  assert.equal(when("2026-11-22T10:29:40Z", now), "เมื่อกี้");
  assert.equal(when("2026-11-22T10:10:00Z", now), "20 นาทีที่แล้ว");
  assert.equal(kindOf("หาตั๋วเครื่องบินราคาถูก"), "plane", "a cheap flight is a flight");
  assert.equal(kindOf("เทียบราคาหูฟัง"), "tag");
  assert.equal(kindOf("อะไรก็ได้"), "sparkle");
  assert.equal(brandOf({ brand: "sony.com", url: "https://shop.example/x" }), "sony.com");
  assert.equal(brandOf({ brand: "Sony Thailand", url: "https://www.shop.example/x" }), "shop.example");
});

test("the answer becomes a short headline, a check list and a numbered list", () => {
  const runs = answerRuns("ร้าน **B** ถูกสุด\n- ส่งฟรี\n- มีโค้ด\n\n1. ร้าน B\n2. ร้าน A\nจบ");
  assert.deepEqual(runs, [
    { kind: "p", lines: ["ร้าน B ถูกสุด"], lead: true },
    { kind: "ul", lines: ["ส่งฟรี", "มีโค้ด"] },
    { kind: "ol", lines: ["ร้าน B", "ร้าน A"] },
    { kind: "p", lines: ["จบ"] },
  ]);
  assert.equal(answerRuns("x".repeat(91))[0].lead, undefined, "a long opening is not a headline");
});

test("the share text carries names, prices, links, codes and when it was checked", () => {
  const t = shareText({ title: "หูฟัง", answer: "", options: [{ name: "Sony", price: "฿8,990", url: "https://b.example/x" }, { name: "JBL", url: "javascript:x" }], codes: [{ code: "SAVE10" }], finishedAt: "2026-11-22T10:00:00Z" });
  assert.match(t, /^Smith เช็กให้: หูฟัง\n1\. Sony · ฿8,990\nhttps:\/\/b\.example\/x\n2\. JBL\nโค้ดที่เจอบนหน้าเว็บ \(อาจหมดอายุ\): SAVE10\nเช็กเมื่อ /);
});
