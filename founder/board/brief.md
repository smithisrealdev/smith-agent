# Brief for the board: Smith Agent

## The idea file

- What it is: a Thai-first agent that does web research tasks for you (find, compare, check, summarise), quotes a fixed price before it starts, charges nothing when it fails, and returns the result with proof you can open yourself.
- Who it is for: Thai-speaking smartphone users who already live in LINE and want an errand done on the web without doing the searching and comparing themselves. No narrower segment has been chosen or tested yet.
- What it sells, at what price: one job at a time, paid from a prepaid credit balance in baht. Small job ฿5, medium ฿9, large ฿15. A failed job costs ฿0. A wrong result can be refunded within 24 hours (automatic 3 times a month, then reviewed by a person).
- Where and how: online, Thailand. A LINE bot and a phone web app (installable from the browser). The user types the task in Thai, sees the plan and price, taps start, and gets the result in 1 to 5 minutes.
- Budget and constraints: solo founder. The product is built and deployed as an invite-only test. No payment system yet: testers get ฿200 of free credit. No marketing budget has been set. No revenue, no paying users and no usage data yet.

## What a stranger needs to know

### What the product does today
- Example tasks: "find the cheapest flight to Chiang Mai this Friday", "compare the price of these headphones at 3 shops with links", "summarise today's news on a topic", "find a restaurant in this area under this budget".
- Flow: the user types a task. Smith replies with a short plan (2 to 4 steps), a size (S, M or L) and its fixed price. Nothing is charged until the user taps start. While it works, the app shows each step live ("searching ...", "reading shop X"). The result comes back as a short Thai answer, up to 3 option cards (product picture, brand logo, name, price, note, link to the page), the source links, and a screenshot of the main page as evidence.
- The result can be read aloud by the phone. There is a "run this again" button, a history, a credit ledger, and self-service account deletion.
- It only searches and reads public web pages. It never logs in, pays, books, fills in forms, calls anyone or acts in the physical world. A task that needs those is refused at the quote step at no charge, or done only up to the research part.
- Languages: Thai only.

### How it is built and what a job costs to run
- Each job is a call to a large language model (Claude) with web search and web fetch tools. A quote is a second, smaller call made before every job, including jobs the user never starts.
- Work budget per size: S allows 3 searches and 2 page reads, M 6 and 4, L 10 and 6.
- The model's list price is about US$4 per million input tokens and US$20 per million output tokens, plus US$0.01 per web search. The founder's working estimate is ฿3 to ฿10 of model cost per job, but this has NOT been measured on real jobs yet.
- Planned way to take money: credit top-ups through the App Store and Google Play in-app purchase. The founder's working assumption is a 15% store fee and 7% Thai VAT, so about 79% of what the user pays is left before model cost. Not built yet.
- Fixed running cost today: one small cloud server.

### Where it stands
- Stage: invite-only test, just deployed. Testers enter an invite code and get ฿200 of credit.
- The founder's own pass marks for the test: at least 80% of jobs succeed, margin after the store fee is above zero, refunds are at most 10% of jobs, and half the testers come back for another job.
- Not yet done: payments, a native app in the stores, connections to the user's own accounts (email, social apps), any marketing, any competitor research, any customer interviews.
- Legal: draft Thai privacy policy and terms exist, not yet reviewed by a lawyer.

### What is not known
- Who the first paying customer segment is.
- Whether people will pay per job at all, and what they do today instead.
- Real model cost per job, real success rate, real refund rate.
- Who the competitors are in Thailand and what they charge.
- Cost of acquiring a customer.
