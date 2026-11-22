# Smith Agent

- What it is: a Thai-first agent that does web research tasks for you (find, compare, check, summarise), quotes a fixed price before it starts, charges nothing when it fails, and returns the result with proof you can open yourself.
- Who it is for: Thai-speaking smartphone users who already live in LINE and want an errand done on the web without doing the searching and comparing themselves. No narrower segment has been chosen or tested yet.
- What it sells, at what price: one job at a time, paid from a prepaid credit balance in baht. Small job ฿5, medium ฿9, large ฿15. A failed job costs ฿0. A wrong result can be refunded within 24 hours (automatic 3 times a month, then reviewed by a person).
- Where and how: online, Thailand. A LINE bot and a phone web app (installable from the browser). The user types the task in Thai, sees the plan and price, taps start, and gets the result in 1 to 5 minutes.
- Budget and constraints: solo founder. The product is built and deployed as an invite-only test. No payment system yet: testers get ฿200 of free credit. No marketing budget has been set. No revenue, no paying users and no usage data yet.

**อัปเดต 22 พ.ย. 2026 (สิ่งที่เปลี่ยนหลังจากเขียนข้างบน):** ชื่อที่ลูกค้าเห็นคือ "Smith" (`brand.md`) · กลุ่มแรกที่เลือกคือเจ้าของร้านเล็กและฟรีแลนซ์ที่เทียบราคาของชิ้นใหญ่ (`marketing.md` แบบ A) · เครดิตทดลอง 3 งานกลาง (฿27) แทน ฿200 และรับผู้ทดลองไม่เกิน 30 บัญชี · มีทางรับเงินจริงแบบทำมือผ่าน PromptPay (ปิดอยู่จนกว่าจะตั้งค่า) · ยังไม่มีผู้ใช้จริง รายได้ หรือข้อมูลต้นทุนจริงต่องาน

**อัปเดต 22 พ.ย. 2026 (หลังวัดต้นทุนจริง):** ใช้โมเดล DeepSeek V4 Flash ผ่าน OpenRouter ต้นทุนวัดจริงราว ฿1.8 ต่องาน (`trial-2026-11-22-corrected.txt` ค่า ฿4.47 ที่เคยเขียนผิด) · ราคางานกลางเป็น ฿12 และเครดิตทดลอง 1 งาน (฿12) ตาม `cfo.md` · ยังไม่มีผู้ใช้จริงหรือรายได้
