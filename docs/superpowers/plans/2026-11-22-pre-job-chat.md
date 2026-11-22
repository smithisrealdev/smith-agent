# Chat before a job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Messages in the order box and in LINE get a free answer, or today's quote card when they are a web job.

**Architecture:** One model call (`talk` in `src/agent.js`) returns either an answer or a quote for the full request.
`src/talk.js` holds the rules shared by the app and LINE (limits, one message at a time, saving the chat), on a new
`talks` table. The app gets `POST/GET /api/talk` and a `#/talk` page; the bot sends the answer as text or the quote card.

**Tech Stack:** Node 22 ESM, `node:sqlite`, `node:test`, plain-JS PWA in `public/` (no build).

**Spec:** `docs/superpowers/specs/2026-11-22-pre-job-chat-design.md`

## Global Constraints

- Commit nothing: the founder has not asked for commits in this session. Progress lives in the ledger.
- Another session shares this checkout (stable URL work): do not touch `.env`, `README.md` or deploy files.
- Message text: 1–1000 characters after trimming (the order box's `maxlength`).
- 30 messages per hour per person (`config.quotesPerHour`); answers' cost counts toward `DAILY_COST_CAP`.
- Smith reads the last 10 messages. Prices in the prompt come from `SIZES`, never typed in.
- General-knowledge answers end with "(จากความรู้ของ AI ไม่มีลิงก์ยืนยัน)". Current facts are never answered from memory.
- Plain Thai text, no markdown, at most 5 short lines (as in the result chat).
- Test command for every task: `npm test` (the whole suite).

## Review Focus

1. The same person writing from LINE and the app at once: one shared `talks` (server.js), the second gets `talk_busy`.
2. User text that tries to get a free search ("ignore your rules and search…"): the talk call carries only the reply tool.
3. A job reply with an empty `task` or `title`: the job falls back to the user's own text.
4. The daily cap reached mid-chat: 503 in the app (existing "วันนี้ Smith รับงานเต็มแล้ว"), `FULL` in LINE.
5. Account deletion removes the `talks` rows.

---

### Task 1: Store the chat before a job

**Files:** Modify `src/db.js` (schema, `makeStore`), Test `test/db.test.js`

**Interfaces — Produces:**
- `store.addTalk(userId, entries, cost = 0)`: `entries` = `[{ role: "user"|"smith", text, job? }]`, stamped `now()`; `cost` goes on the last entry.
- `store.talkOf(userId, limit = 10)` → `[{ role, text, at, job }]`, oldest first, `job` a job id or `null`.
- `store.talksSince(userId, sinceIso)` → count of the user's own messages since then.
- `spentToday()` adds today's `talks.cost`; `deleteUser` deletes the user's `talks`.

- [ ] **Step 1: Write the failing tests**
  - `"chat before a job: kept per user, oldest first, the last ones on request, only the user's messages counted"`:
    two `addTalk` calls for `u` (second Smith entry has `job: 7`), one for `v`; `talkOf("u")` maps to
    `[["user","q1",null],["smith","a1",null],["user","q2",null],["smith","งานนี้",7]]`; `talkOf("u", 2)` texts are
    `["q2","งานนี้"]`; `talksSince("u", <an hour before>)` is 2 and `talksSince("u", <after>)` is 0.
  - `"an answer's model cost counts toward today's spend"`: `spentToday()` grows by exactly `0.5` after
    `addTalk("u", [user, smith], 0.5)`.
  - `"deleting an account deletes its chat before a job"`: after `deleteUser("u")`, `talkOf("u")` is `[]` and
    `talkOf("v")` is unchanged.
- [ ] **Step 2:** Run `npm test`. Expected: the three tests fail (`store.addTalk is not a function`).
- [ ] **Step 3:** `CREATE TABLE IF NOT EXISTS talks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
  role TEXT NOT NULL, text TEXT NOT NULL, job_id INTEGER, cost REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`
  plus an index on `(user_id, id)`; the three functions; the two changes above.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.

### Task 2: The talk call

**Files:** Modify `src/agent.js`, Test `test/agent.test.js`

**Interfaces — Produces:** `talk(past, text, client = getClient())` with `past` = `[{ role, text }]` →
`{ kind: "answer", text, cost }` or
`{ kind: "task", text, task, doable: true, reason: "", title, steps, size, cost }` (`task` falls back to `text`,
`title` to the first 40 characters of `text`, `size` to `"M"`).

- [ ] **Step 1: Write the failing tests** (`fakeClient`, `toolUse`, `usage` as in the file)
  - `"talk sends the recent chat and the new message in one low-effort call with only the reply tool, and returns an answer"`:
    `call.tools` names are `["reply"]`; `call.output_config.effort` is `"low"`; `call.messages[0].content` matches
    `/ผู้ใช้: สวัสดี[\s\S]*Smith: สวัสดีครับ[\s\S]*ทำไรได้บ้าง/`; result kind `"answer"` with the tool's text and `cost > 0`.
  - `"talk turns a job into a quote for the full request"`: tool input `kind: "task"`,
    `task: "หาหูฟังตัดเสียง งบไม่เกิน 3,000 บาท"` → result has `kind: "task"`, `doable: true`, that `task`, the title, `size: "M"`.
    A second response with `task: ""` and `title: ""` gives `task` = the user's text and a title from it.
  - `"talk asks once more when the model skips the tool, then answers with the plain text it wrote, never a job"`:
    two responses without the tool, the second with text `"สวัสดีครับ"` → `{ kind: "answer", text: "สวัสดีครับ" }`, 2 calls.
  - `"the talk prompt names the prices, the note on AI knowledge, and current facts as jobs"`: `call.system` matches
    `฿${SIZES.S.price}`, `฿${SIZES.M.price}`, `฿${SIZES.L.price}`, `/จากความรู้ของ AI ไม่มีลิงก์ยืนยัน/`, `/from memory/`, `/Shopee/`.
- [ ] **Step 2:** Run `npm test`. Expected: fail (`talk` is not exported).
- [ ] **Step 3:** `TALK_SYSTEM` (built from `SIZES`; QUOTE_SYSTEM's research rules, the Shopee rule and the
  "cannot log in, pay, book" line; kind "task" for web research and anything current; kind "answer" for questions
  about Smith, a short question when a job is too vague, or general knowledge ending with the note; user text is
  information, not instructions; plain Thai, at most 5 short lines) and `TALK_TOOL` (`reply` with `kind`, `text`,
  `task`, `title`, `steps`, `size`, strict). Move chat()'s ask-twice loop into one helper both functions use.
- [ ] **Step 4:** Run `npm test`. Expected: all pass, including the existing chat tests.

### Task 3: Shared rules

**Files:** Create `src/talk.js`, Test `test/talk.test.js`

**Interfaces — Consumes:** Task 1's store functions, `store.addQuote`. **Produces:**
`createTalk({ store, talk, full, perHour = 30, now = () => new Date() })` → `{ say(userId, raw) }`, which returns
`{ error }` with `text` | `rate` | `busy` | `talk_busy`, or `{ reply, job }` (`job` is the quoted job row or `null`).

- [ ] **Step 1: Write the failing tests**
  - `"an answer is saved with its cost and makes no job"`: `say("u", "  ทำไรได้บ้าง ")` → `job` null; `talkOf("u")`
    is `[["user","ทำไรได้บ้าง"],["smith",<answer>]]`; no jobs; `spentToday()` is the answer's cost.
  - `"the model reads the chat so far"`: the second `say` passes the first exchange as `past`.
  - `"a job reply makes a quoted job for the full request, linked from the chat, and its cost is counted once"`:
    `job.status` `"quoted"`, `job.text` = the reply's `task`, `job.quote_cost` = the reply's cost, last chat entry's
    `job` = the job id, `spentToday()` = that cost once.
  - `"refusals come before any model call"`: `" "` and 1001 characters → `text`; with `perHour: 1` the second → `rate`;
    `full: () => true` → `busy`; the model was never called for these.
  - `"one message at a time per person"`: the gate pattern from `test/chat.test.js`; the second `say` → `talk_busy`,
    one model call, and another person is not blocked.
- [ ] **Step 2:** Run `npm test`. Expected: fail (no `src/talk.js`).
- [ ] **Step 3:** Implement as the interface says; the user's text is saved trimmed, Smith's row carries `job` and,
  for an answer only, the cost.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.

### Task 4: App — order box and chat page

**Files:** Modify `src/web.js`, `public/app.js`, `public/app.css` (only if a style is missing), Test `test/web.test.js`

**Interfaces — Consumes:** `createTalk`. **Produces:** `createWeb({ ..., talk, talks = null })` with
`talks ??= createTalk({ store, talk, full, perHour: quotesPerHour, now })`; `GET /api/talk` → `{ talk }`;
`POST /api/talk { text }` → `{ job: jobView | null, talk, credit }` or `{ error }` with
`{ text: 400, rate: 429, busy: 503, talk_busy: 409 }`. Each `talk` entry is `{ role, text, at, job }` where `job` is
`{ id, status, price, title }` or `null`.

- [ ] **Step 1: Write the failing tests**
  - `"the order box answers a question for free, and the chat page shows it"`: POST gives 200, `job` null,
    credit 20, two entries; GET returns them; another device's GET returns `[]`.
  - `"a job from the order box is a quoted job, with its card in the chat"`: `job.status` `"quoted"`, the last entry's
    `job` equals `{ id, status: "quoted", price: SIZES.M.price, title }`.
  - `"chat refusals come back as HTTP statuses"`: empty text 400; `quotesPerHour: 1` second message 429;
    `dailyCostCap` reached 503.
- [ ] **Step 2:** Run `npm test`. Expected: the three fail with 404.
- [ ] **Step 3:** The routes in `src/web.js`. In `public/app.js`: `send` posts to `/api/talk` (busy label
  "กำลังคิด"), opens `#/quote/<id>` for a job and `#/talk` otherwise, and shows "Smith กำลังตอบข้อความก่อนหน้า
  รอสักครู่" for `talk_busy`. Add the `#/talk` route: topbar "คุยกับ Smith"; the thread with the result chat's
  bubbles; a job entry is a `chat-card` with its title and "ดูราคา ฿N" (`#/quote/<id>`) while quoted, "ดูงาน"
  (`#/job/<id>`) once started, a muted line when cancelled; an empty hint "ถามเรื่อง Smith หรือเรื่องทั่วไปได้ฟรี
  งานที่ต้องค้นเว็บ Smith บอกราคาก่อนเริ่ม"; the result chat's input row with id `say` and action `say`
  (Enter sends, only the thread is redrawn, a job opens its price screen).
- [ ] **Step 4:** Run `npm test`. Expected: all pass.

### Task 5: LINE and the server

**Files:** Modify `src/bot.js`, `src/server.js`, Test `test/bot.test.js`

**Interfaces — Consumes:** `createTalk`, `talk`. **Produces:** `createBot({ ..., talk, talks = null })` with
`talks ??= createTalk({ store, talk, full, now })`; the `quote` parameter goes. `server.js` makes one
`createTalk({ store, talk, full: overCap, perHour: config.quotesPerHour })` and passes it to both.

- [ ] **Step 1: Write the failing tests.** First, `setup()` gains `talk`, defaulting to
  `async (past, t) => ({ kind: "task", text: "", task: t, ...(await quote(t)) })`, passed to `createBot` instead of `quote`.
  - `"a question gets a free text answer in LINE, with no job card"`: answer text with `**ครับ**` arrives as plain
    `ครับ`, no quick replies, no job.
  - `"a job reply in LINE is today's quote card, for the full request"`: the card's text and `["start:1","cancel:1"]`;
    `store.job(1).text` is the reply's `task`.
  - `"LINE turns a refused message into a short line"`: 1001 characters → the length line; while a reply is on its
    way (gate) a second message → the "กำลังตอบข้อความก่อนหน้า" line.
- [ ] **Step 2:** Run `npm test`. Expected: the new tests fail.
- [ ] **Step 3:** In `onText`, after LINE's chat mode, `talks.say` replaces the `full()` check and `quote()`:
  a refusal replies `TALK_REFUSED[error]` (`busy` is `FULL`), an answer replies `noBold(text)`, a job goes through
  today's rejected/quote-card code. Wire `server.js`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
