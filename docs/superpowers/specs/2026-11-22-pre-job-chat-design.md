# Chat before a job — design

Approved by the founder on 2026-11-22 ("อนุมัติ ลุยเลย").

## Why

People want to ask before they pay. Today every message is a job order: a question such as "ทำไรได้บ้าง" becomes a
"Smith ทำไม่ได้" card (2 of the first 11 jobs). Seeing a price is already free; only Start charges.

## What

- Every message in the order box ("อยากให้ Smith ช่วยอะไร…") and in the LINE chat gets one of two replies, decided in
  one model call:
  - **Free answer:** about Smith (what it does, prices S/M/L from `SIZES`, failed jobs cost nothing, refunds, how to
    order), one short question when a job is too vague to plan, or general knowledge from the model, ending with
    "(จากความรู้ของ AI ไม่มีลิงก์ยืนยัน)". The founder chose to allow general knowledge.
  - **Job card:** web research, or anything that must be current (prices, fares, availability, opening hours,
    schedules, news, stock). Never answered from memory. It is today's quote card; only Start charges.
- Smith reads the last 10 messages. A job's text is the full request with the details from the chat
  ("หูฟังตัดเสียง งบไม่เกิน 3,000").
- App: a job goes straight to the price screen, as today. An answer opens a chat page (`#/talk`) with a box to keep
  typing; job replies there show a card that opens the job.
- LINE: an answer is a text reply; a job is today's quote card.
- Limits: 30 messages per hour per person (`QUOTES_PER_HOUR`); answers' model cost counts toward `DAILY_COST_CAP`.
  One message at a time per person, shared by the app and LINE.
- Deleting an account deletes this chat (the consent screen promises all data goes).
- Unchanged: prices, start and refunds, the chat under a result, the free re-search, LINE's chat mode after "ถามต่อ".

## Approaches

1. **One call that answers or quotes (picked).** Same cost and speed as a quote today (about ฿0.01).
2. Chat first, then a separate quote call: two calls per job, slower and dearer, and two prompts can disagree.
3. Answer only when the quote says "not doable": no memory, so it cannot hold a conversation.

## Builder's calls

- Messages live in a `talks` table, one row per message with Smith's cost on its row: the hourly limit and the daily
  cost cap need each message's time and cost. A job reply's row costs 0, since the job's `quote_cost` holds it.
- The order box and the chat page use `POST /api/talk`; `GET /api/talk` loads the chat page. `/api/quote` stays for
  the price screen's retry.
- The talk call has no web tools at all, so free chat cannot search whatever the user writes.
- A job reply in LINE sends only the quote card.
