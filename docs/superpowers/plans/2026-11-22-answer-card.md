# Answer Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smith's answer on the result screen reads as a short, labelled headline with the option cards doing the detail, as in the design's Done board.

**Architecture:** A prompt rule makes answers with options 1–2 sentences. The app renders the answer through `answerCard(j)`: a pill label, the first paragraph as a headline, and list lines as a real list with the app's check icon.

**Tech Stack:** Node 22 (`node:test`), plain JS/CSS web app.

**Spec:** `docs/superpowers/specs/2026-11-22-answer-card-design.md`

## Global Constraints

- With options: at most 2 short sentences, no option list, no emoji. Without options: at most 8 short lines; a list line starts with `- `.
- Label `Smith แนะนำ` when the job has options, otherwise `สรุปจาก Smith`.
- A list line matches `/^\s*(?:[-•*]|✅|✔️?|\d+[.)])\s+/u`. A blank line separates blocks, and a block is a list only when every line in it is a list line.
- Every string goes through `esc`. Failed jobs and LINE are unchanged. No commits.

## Review Focus

1. An old long answer (blocks of text, then ✅ lines): it shows as a headline, a checked list and a paragraph, with no ✅ left in the list.
2. An answer with no blank lines and no list lines: one headline paragraph.
3. A line like `1,290 บาท` or `-5%` is not taken for a list line, because the marker must be followed by a space.
4. An empty answer: the card still renders its label, with no empty list.
5. Dark theme: the card and the pill use tokens, so text stays readable.

---

### Task 1: Shorter answers from the agent

**Files:** Modify `src/agent.js` (`RUN_SYSTEM` answer rule). Test: `test/agent.test.js`.

- [ ] **Step 1: Failing test** `"the run prompt keeps answers with options to 2 sentences, without emoji"`. Run `runTask` with a fake client and assert that `calls[0].system` includes `at most 2 short sentences` and `No emoji`.
- [ ] **Step 2:** Run `node --disable-warning=ExperimentalWarning --env-file=test/test.env --test test/agent.test.js`. Expected: FAIL on that test.
- [ ] **Step 3:** Replace the `- answer:` line of `RUN_SYSTEM` with the rule from Global Constraints. It keeps "concrete names, prices in baht and dates", and says the app shows options as cards.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.

### Task 2: The answer card

**Files:** Modify `public/app.js` (`doneView` answer card; a new `answerCard(j)` next to it) and `public/app.css`.

- [ ] **Step 1:** `answerCard(j)` returns `<div class="card pad answer">` holding the pill label, then each block as either `<p>` (pre-wrap) or `<ul class="answer-list">` of `<li>` with `svg(IC.bold.check, 16)` and the line minus its marker. `doneView` uses it in place of the `card pad pre` answer div.
- [ ] **Step 2:** CSS in the answer card:
  - a column with a 10px gap
  - the first `p` in Mitr 17px weight 500
  - list items: flex rows with an 8px gap, the check in `--gtxt`
  - all colours from tokens
- [ ] **Step 3:** Run `node --check public/app.js && npm test`. Expected: no output from the check; the suite passes.

### Task 3: Check in the real app

- [ ] Restart the check server (port 3001). Open the old long answers (jobs 4 and 7) at 375px in light and dark: label, headline, checked list, no ✅, no sideways scroll.
- [ ] Run one new real job and check that the answer is 1–2 sentences with the option cards below.
