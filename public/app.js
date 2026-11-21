// Smith Agent phone app. One file, no build step: each screen is a function that returns HTML,
// and every value from the server or the user goes through esc() before it reaches the page.
(() => {
  "use strict";
  const app = document.getElementById("app");
  const M = window.MASCOTS || {};

  // ---------- storage and the device token
  const saved = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem(`smith.${k}`));
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`smith.${k}`, JSON.stringify(v));
      } catch {
        // private browsing: the value lives for this visit only
      }
    },
  };
  // crypto.randomUUID needs https; getRandomValues also works over plain http on the home network.
  const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  let token = saved.get("token");
  if (!token) {
    token = newToken();
    saved.set("token", token);
  }

  // ---------- small helpers
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const baht = (n) => `฿${Number(n || 0).toLocaleString("th-TH")}`;
  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const clock = (d) => d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  const when = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const mins = (Date.now() - d) / 60000;
    if (mins < 1) return "เมื่อกี้";
    if (mins < 60) return `${Math.floor(mins)} นาทีที่แล้ว`;
    if (new Date().toDateString() === d.toDateString()) return `วันนี้ ${clock(d)}`;
    return `${d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })} ${clock(d)}`;
  };
  const duration = (from, to = new Date().toISOString()) => {
    const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
    if (s < 60) return `${s} วินาที`;
    return `${Math.floor(s / 60)} นาที${s % 60 ? ` ${s % 60} วินาที` : ""}`;
  };

  // Icons come from icons.js: bold for controls and text, duotone inside tiles. The LINE mark is LINE's own.
  const IC = window.ICONS || { bold: {}, duotone: {}, line: "" };
  const svg = (d, size = 20, box = 256) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}" fill="currentColor">${d || ""}</svg>`;
  const I = Object.fromEntries(Object.entries(IC.bold).map(([k, d]) => [k, svg(d)]));
  const D = Object.fromEntries(Object.entries(IC.duotone).map(([k, d]) => [k, svg(d, 24)]));
  const LINE_MARK = svg(IC.line, 24, 24);
  const DOTS = '<span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>';

  // ---------- state and server calls
  const state = { me: null, jobs: [], job: null, draft: saved.get("draft") || "", slide: 0, refund: null };
  let poller;

  class InviteNeeded extends Error {}
  class LoginNeeded extends Error {}
  class Stale extends Error {} // the user moved to another screen while this loaded
  async function api(method, path, body) {
    const at = location.hash;
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Invite": saved.get("invite") || "" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("offline");
    }
    const data = await res.json().catch(() => ({}));
    if (method === "GET" && location.hash !== at) throw new Stale(); // a late load must not paint over the newer screen
    if (res.status === 403 && data.error === "invite") throw new InviteNeeded();
    if (res.status === 401 && data.error === "login") throw new LoginNeeded();
    return { ok: res.ok, status: res.status, data };
  }

  // Refresh a screen every few seconds. A network blip retries; leaving the screen stops it.
  const poll = (fn, ms) => (poller = setTimeout(() => fn().catch((e) => e instanceof Stale || poll(fn, 5000)), ms));

  function toast(msg) {
    document.querySelector(".toast")?.remove();
    const el = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    el.setAttribute("role", "status");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ---------- shared pieces
  const topbar = (title, back = "#/") =>
    `<div class="topbar"><a class="icon-btn" href="${back}" aria-label="กลับ">${I.back}</a><div class="title">${esc(title)}</div><span class="gap44"></span></div>`;
  const STATUS = {
    quoted: ["รอเริ่ม", "grey", "clock"],
    running: ["กำลังทำ", "", "bolt"],
    done: ["เสร็จแล้ว", "good", "check"],
    failed: ["ไม่สำเร็จ ไม่คิดเงิน", "bad", "x"],
    refunded: ["คืนเงินแล้ว", "warn", "refund"],
    refund_review: ["รอตรวจคืนเงิน", "warn", "refund"],
    cancelled: ["ยกเลิกแล้ว", "grey", "x"],
    rejected: ["Smith ทำไม่ได้", "grey", "x"],
  };
  const jobRow = (j) => {
    const [label, tone, ic] = STATUS[j.status] || ["", "grey", "clock"];
    const href = j.status === "quoted" || j.status === "rejected" ? `#/quote/${j.id}` : `#/job/${j.id}`;
    const charged = ["done", "refund_review", "running"].includes(j.status);
    return `<a class="item" href="${href}"><span class="tile ${tone}">${D[ic]}</span>
      <span class="grow col" style="gap:2px;min-width:0"><span class="t">${esc(j.title || j.text)}</span>
      <span class="s">${esc(when(j.createdAt))} · ${label}${j.status === "running" ? ` ${DOTS}` : ""}</span></span>
      ${charged ? `<span class="money">${baht(j.price)}</span>` : ""}</a>`;
  };
  const siteTile = (url) => `<span class="tile">${D.link}${hostOf(url) ? `<img class="logo" src="/logo/${esc(hostOf(url))}.png" alt="" loading="lazy">` : ""}</span>`;
  const sourceRow = (s) =>
    /^https?:\/\//.test(s.url)
      ? `<a class="source" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${siteTile(s.url)}
        <span class="grow col" style="gap:2px;min-width:0"><span class="t" style="font-size:14px">${esc(s.title || hostOf(s.url))}</span><span class="host">${esc(hostOf(s.url))}</span></span>${I.external}</a>`
      : "";

  // ---------- onboarding
  const SLIDES = [
    { m: "idle", h: "บอกสิ่งที่อยากได้<br>แล้วปล่อยให้ Agent<br>ไปทำแทนคุณ", p: "หาตั๋ว เทียบราคา สรุปข่าว หาร้าน พิมพ์มาเหมือนคุยกับเพื่อน" },
    { m: "small", h: "Agent บอกแผน<br>และราคาก่อนลงมือ", p: "จ่ายไม่เกินราคาที่บอก ไม่สำเร็จ ไม่คิดเงิน", price: true },
    { m: "done", h: "ทุกงานจบด้วยลิงก์<br>และภาพหน้าจอ<br>ที่เปิดดูเองได้", p: "ผลไม่ตรง ขอเงินคืนได้ใน 24 ชั่วโมง" },
  ];
  function welcome() {
    const s = SLIDES[Math.min(state.slide, SLIDES.length - 1)];
    const last = state.slide >= SLIDES.length - 1;
    render(`<div class="slide-dots" aria-hidden="true">${SLIDES.map((_, i) => `<span class="${i === state.slide ? "on" : ""}"></span>`).join("")}</div>
      <div class="grow"></div>
      <div class="center" style="gap:14px"><div class="mascot" style="min-height:150px">${M[s.m] || ""}</div>
        ${s.price ? '<span class="credit-chip" style="font-size:22px;height:48px;padding:0 20px">฿12</span>' : ""}
        <h1 style="font-size:30px">${s.h}</h1><p class="muted" style="font-size:16px;line-height:1.5">${s.p}</p></div>
      <div class="grow"></div>
      <button class="btn" data-act="next">${last ? "เริ่มเลย" : "ถัดไป"}</button>
      ${last ? "" : '<button class="btn second" data-act="skip">ข้าม</button>'}`);
  }

  function consent() {
    render(`<div class="center" style="padding-top:12px"><div class="mascot" style="min-height:96px">${M.small || ""}</div>
        <h1 style="font-size:25px">ก่อนเริ่ม ขออนุญาตหน่อยนะ</h1></div>
      <div class="note" style="background:var(--soft)">${I.info}<span class="col" style="gap:6px"><b>จำเป็นต่อการใช้งาน</b>
        <span>ใช้คำสั่งและผลงานเพื่อทำงานให้คุณ ไม่ขายข้อมูลให้ใคร และลบบัญชีพร้อมข้อมูลทั้งหมดได้เองในหน้าตั้งค่า</span>
        <span>คำสั่งและหน้าเว็บที่ Agent อ่าน จะส่งไปประมวลผลกับผู้ให้บริการ AI ในต่างประเทศ ภายใต้สัญญาที่ห้ามนำไปฝึก AI</span></span></div>
      <div class="note">${I.lock}<span>อย่าพิมพ์รหัสผ่าน เลขบัตร หรือ OTP ลงในคำสั่ง Smith ไม่ต้องใช้ข้อมูลเหล่านี้</span></div>
      <a class="link-btn" href="#/privacy" style="align-self:center">อ่านนโยบายความเป็นส่วนตัว</a>
      <div class="grow"></div>
      <button class="btn" data-act="consent">ยอมรับและไปต่อ</button>`);
  }

  function invite() {
    render(`<div class="center" style="padding-top:24px"><div class="mascot">${M.small || ""}</div><h1 style="font-size:25px">ใส่รหัสเชิญ</h1>
        <p class="muted">ช่วงทดลอง Smith เปิดให้เฉพาะคนที่ได้รับรหัสจากทีมงาน</p></div>
      <label class="sr" for="invite">รหัสเชิญ</label>
      <input id="invite" class="field" autocomplete="off" autocapitalize="off" placeholder="รหัสเชิญ" value="${esc(saved.get("invite") || "")}">
      ${saved.get("invite") ? '<p role="alert" class="small" style="color:var(--rtxt);padding:0 4px">รหัสนี้ใช้ไม่ได้ ลองเช็กกับทีมงานอีกครั้ง</p>' : ""}
      <div class="grow"></div>
      <button class="btn" data-act="invite">ไปต่อ</button>`);
  }

  // ---------- sign in (only when the server has LINE Login set up)
  function login() {
    const failed = location.hash.includes("e=1");
    render(`<div class="grow"></div>
      <div class="center" style="gap:12px"><div class="mascot" style="min-height:140px">${M.idle || ""}</div>
        <h1>ยินดีต้อนรับสู่ Smith</h1><p class="muted" style="font-size:16px;line-height:1.5">เข้าสู่ระบบเพื่อสั่งงาน<br>แล้วรับผลเข้าแชท LINE ของคุณ</p></div>
      ${failed ? '<p role="alert" class="small" style="color:var(--rtxt);text-align:center">เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง</p>' : ""}
      <div class="grow"></div>
      <button class="btn line" data-act="line-login">${LINE_MARK}เข้าสู่ระบบด้วย LINE</button>
      <p class="small muted" style="text-align:center;line-height:1.6">การเข้าสู่ระบบถือว่าคุณยอมรับ <a href="#/terms">เงื่อนไขการใช้งาน</a><br>และ <a href="#/privacy">นโยบายความเป็นส่วนตัว</a></p>`);
  }

  // Draft legal text for the invite-only test, written from what the system actually does. A lawyer must review it before launch.
  const UPDATED = "ฉบับร่างสำหรับช่วงทดลอง · ปรับปรุงล่าสุด 21 พ.ย. 2569";
  const PRIVACY = [
    ["ข้อมูลที่เราเก็บ", ["คำสั่งงาน ผลงาน ลิงก์และภาพหน้าจอที่ใช้เป็นหลักฐาน", "ประวัติเครดิต และเหตุผลที่คุณขอเงินคืน", "รหัสบัญชี LINE ของคุณ เมื่อเข้าสู่ระบบด้วย LINE", "รหัสอุปกรณ์แบบสุ่ม ซึ่งเราเก็บเฉพาะค่าที่เข้ารหัสทางเดียวแล้ว"]],
    ["ข้อมูลที่เราไม่เก็บ", ["รหัสผ่าน เลขบัตรประชาชน ข้อมูลบัตรเครดิต หรือรหัส OTP Smith ไม่ต้องใช้ข้อมูลเหล่านี้ อย่าพิมพ์ลงในคำสั่ง"]],
    ["เราใช้ข้อมูลทำอะไร", ["ทำงานตามคำสั่งของคุณ และส่งผลให้คุณ (ฐานสัญญา)", "คิดเครดิตและคืนเครดิต", "ป้องกันการใช้งานผิดวัตถุประสงค์ และปรับปรุงบริการจากสถิติรวม (ฐานประโยชน์โดยชอบด้วยกฎหมาย)"]],
    ["ใครได้รับข้อมูล", ["ผู้ให้บริการ AI (Anthropic สหรัฐอเมริกา) ประมวลผลคำสั่งและหน้าเว็บที่ Agent อ่าน ภายใต้สัญญาที่ห้ามนำไปฝึก AI", "LINE เมื่อคุณเข้าสู่ระบบหรือรับผลงานทาง LINE", "บริการโลโก้เว็บไซต์ของ Google ได้รับเฉพาะชื่อเว็บไซต์ที่อยู่ในผลงาน ไม่มีข้อมูลที่ระบุตัวคุณ", "ผู้ให้บริการเซิร์ฟเวอร์ที่ Smith ใช้", "เราไม่ขายข้อมูลให้ใคร"]],
    ["เก็บนานแค่ไหน", ["เก็บจนกว่าคุณจะลบบัญชี ซึ่งทำได้เองทันทีในหน้าตั้งค่า งาน หลักฐาน และประวัติเครดิตจะถูกลบทั้งหมด", "เมื่อจบช่วงทดลอง เราอาจลบข้อมูลทั้งหมดของช่วงทดลอง"]],
    ["สิทธิ์ของคุณ", ["ขอดูหรือขอสำเนาข้อมูล ขอแก้ไข ขอลบ และคัดค้านการใช้ข้อมูล", "ร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (สคส.) ได้"]],
    ["ความปลอดภัย", ["ภาพหลักฐานตั้งชื่อแบบสุ่มที่เดาไม่ได้", "ทีมงานเข้าถึงข้อมูลเฉพาะเท่าที่จำเป็นต่อการดูแลบริการ"]],
  ];
  const TERMS = [
    ["Smith ทำอะไร", ["Agent ค้น เทียบ และสรุปข้อมูลจากเว็บไซต์สาธารณะตามคำสั่งของคุณ", "Smith ไม่จ่ายเงิน ไม่ล็อกอิน และไม่จองแทนคุณ"]],
    ["ราคาและเครดิต", ["Smith บอกราคาก่อนเริ่มทุกงาน และหักเครดิตไม่เกินราคานั้น", "งานที่ทำไม่สำเร็จไม่คิดเงิน", "เครดิตใช้ได้เฉพาะใน Smith แลกเป็นเงินสดไม่ได้ และหายไปเมื่อลบบัญชี"]],
    ["การขอเงินคืน", ["ขอได้ภายใน 24 ชั่วโมงหลังได้ผลงาน คืนเป็นเครดิตอัตโนมัติเดือนละ 3 ครั้ง เกินนั้นทีมงานตรวจให้ภายใน 1 วันทำการ"]],
    ["ความถูกต้องของข้อมูล", ["ข้อมูลมาจากเว็บไซต์ภายนอก ราคาและรายละเอียดเปลี่ยนได้ตลอด ตรวจกับเว็บต้นทางก่อนตัดสินใจทุกครั้ง", "ความรับผิดของ Smith ต่องานหนึ่งงาน จำกัดไม่เกินค่าบริการของงานนั้น เท่าที่กฎหมายอนุญาต"]],
    ["สิ่งที่ห้ามทำ", ["สั่งงานที่ผิดกฎหมาย ละเมิดสิทธิ์ผู้อื่น หรือส่งสแปม", "พยายามรับเครดิตฟรีหรือขอเงินคืนโดยไม่สุจริต", "ทีมงานระงับบัญชีที่ทำผิดเงื่อนไขได้"]],
    ["การเปลี่ยนแปลง", ["เราจะแจ้งในแอปก่อนเงื่อนไขใหม่มีผล เงื่อนไขนี้ใช้กฎหมายไทย"]],
  ];
  const legal = (title, sections) => () =>
    render(`<div class="topbar"><button class="icon-btn" data-act="back" aria-label="กลับ">${I.back}</button><div class="title">${title}</div><span class="gap44"></span></div>
      <div class="note warn">${I.info}<span>${UPDATED}</span></div>
      ${sections.map(([h, items]) => `<div class="sect">${h}</div><div class="card pad col">${items.map((t) => `<p style="line-height:1.55">${t}</p>`).join("")}</div>`).join("")}`);
  const privacy = legal("นโยบายความเป็นส่วนตัว", PRIVACY);
  const terms = legal("เงื่อนไขการใช้งาน", TERMS);

  // ---------- home
  const TEMPLATES = [
    { label: "หาตั๋วเครื่องบินถูกสุด", icon: "plane", text: "หาตั๋วเครื่องบินไป [เมือง] วันที่ [วัน] กลับวันที่ [วัน] ราคาถูกสุด รวมกระเป๋า" },
    { label: "เทียบราคาสินค้า", icon: "tag", text: "เทียบราคา [ชื่อสินค้า] จาก 3 ร้าน พร้อมลิงก์" },
    { label: "สรุปข่าววันนี้", icon: "doc", text: "สรุปข่าวสำคัญวันนี้เรื่อง [หัวข้อ] 5 ข้อ พร้อมแหล่งข่าว" },
    { label: "หาร้านอาหาร", icon: "food", text: "หาร้านอาหาร [ประเภท] ย่าน [ที่] งบไม่เกิน [บาท] ต่อคน รีวิวดี" },
  ];
  async function home() {
    const [me, list] = await Promise.all([api("GET", "/api/me"), api("GET", "/api/jobs")]);
    state.me = me.data;
    state.jobs = list.data.jobs || [];
    render(homeView());
    if (state.jobs.some((j) => j.status === "running")) poll(refreshHome, 5000);
  }
  // Only the credit, the running card and the job list are redrawn, so the composer and what the user types stay put.
  async function refreshHome() {
    const [me, list] = await Promise.all([api("GET", "/api/me"), api("GET", "/api/jobs")]);
    if (me.ok) state.me = me.data;
    if (list.ok) state.jobs = list.data.jobs;
    for (const [id, html] of Object.entries(homeParts())) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    }
    if (state.jobs.some((j) => j.status === "running")) poll(refreshHome, 5000);
  }
  const liveCard = (j) => `<a class="item live-card" href="#/job/${j.id}"><span class="tile">${D.bolt}</span>
      <span class="grow col" style="gap:2px;min-width:0"><span class="t">${esc(j.title || j.text)}</span>
      <span class="s">${esc(j.progress?.at(-1)?.text || "กำลังเริ่มงาน")} ${DOTS}</span><span class="s">ผ่านไป ${duration(j.startedAt)}</span></span>${I.chev}</a>`;
  function homeParts() {
    const running = state.jobs.filter((j) => j.status === "running");
    const jobs = state.jobs.filter((j) => !["rejected", "cancelled", "running"].includes(j.status)).slice(0, 5);
    const empty = running.length ? "" : `<div class="sect">งานของฉัน</div><div class="note">${I.info}<span>งานที่สั่งจะอยู่ตรงนี้ Smith บอกราคาก่อนเริ่มทุกงาน และไม่สำเร็จไม่คิดเงิน</span></div>`;
    return {
      "home-credit": `<a class="credit-chip" href="#/wallet" aria-label="เครดิต ${baht(state.me.credit)}">${I.wallet} ${baht(state.me.credit)}</a>`,
      "home-live": running.map(liveCard).join(""),
      "home-jobs": jobs.length
        ? `<div class="row" style="justify-content:space-between"><div class="sect">งานของฉัน</div><a class="link-btn" href="#/history">ดูทั้งหมด</a></div><div class="card list">${jobs.map(jobRow).join("")}</div>`
        : empty,
    };
  }
  function homeView() {
    const slot = Object.fromEntries(Object.entries(homeParts()).map(([id, html]) => [id, `<div class="slot" id="${id}">${html}</div>`]));
    return `<div class="topbar"><a class="icon-btn" href="#/settings" aria-label="ตั้งค่า">${I.person}</a><span class="grow"></span>${slot["home-credit"]}</div>
      ${slot["home-live"]}
      <div class="row" style="align-items:flex-end"><h1 class="grow">อยากให้ Smith<br>ช่วยอะไรวันนี้</h1><span style="flex:none">${M.small || ""}</span></div>
      <div class="composer">
        <label class="sr" for="cmd">พิมพ์งานที่อยากให้ทำ</label>
        <textarea id="cmd" class="field" rows="3" maxlength="1000" placeholder="เช่น หาตั๋วไปเชียงใหม่ศุกร์นี้ กลับอาทิตย์ ถูกสุด">${esc(state.draft)}</textarea>
        <button class="btn" data-act="send">สั่งงาน Agent</button>
      </div>
      <div class="hscroll" role="group" aria-label="ตัวอย่างงาน">${TEMPLATES.map((t, i) => `<button class="chip" data-act="template" data-arg="${i}">${I[t.icon]}${esc(t.label)}</button>`).join("")}</div>
      ${slot["home-jobs"]}`;
  }

  // ---------- quote
  async function quoteScreen(id) {
    const r = await api("GET", `/api/jobs/${id}`);
    if (!r.ok) return render(notFound());
    const { job, credit } = r.data;
    state.job = job;
    if (!["quoted", "rejected"].includes(job.status)) return go(`#/job/${id}`);
    render(job.status === "rejected" ? rejectedView(job) : quoteView(job, credit));
  }
  function quoteView(j, credit) {
    const short = credit < j.price;
    return `${topbar("ตรวจก่อนเริ่ม")}
      <div class="bubble pre">${esc(j.text)}</div>
      <div class="plan"><div class="mitr" style="font-weight:600;font-size:17px">Agent จะทำแบบนี้</div>
        ${j.steps.map((s, i) => `<div class="step"><span class="n">${i + 1}</span><span>${esc(s)}</span></div>`).join("")}
        <div class="small muted">Agent จะไม่จ่ายเงิน ไม่ล็อกอิน และไม่จองแทนคุณ</div></div>
      <div class="price-card"><div class="col" style="gap:0"><div class="mitr" style="font-weight:600;font-size:17px">ราคางานนี้</div><div class="big">${baht(j.price)}</div></div>
        <div class="checks grow"><span>${I.check}จ่ายไม่เกินนี้</span><span>${I.check}ไม่สำเร็จ ไม่คิดเงิน</span><span>${I.check}ประมาณ ${j.minutes} นาที</span></div></div>
      <div class="small muted" style="padding:0 4px">เครดิตคงเหลือ ${baht(credit)}</div>
      ${short ? `<div class="note warn">${I.info}<span>เครดิตไม่พอสำหรับงานนี้ <a href="#/wallet">ดูวิธีเติมเครดิต</a></span></div>` : ""}
      <div class="grow"></div>
      <button class="btn" data-act="start" data-arg="${j.id}" ${short ? "disabled" : ""}>เริ่มงาน ${baht(j.price)}</button>
      <button class="btn second" data-act="edit">แก้คำสั่ง</button>`;
  }
  const rejectedView = (j) => `${topbar("ตรวจก่อนเริ่ม")}
      <div class="bubble pre">${esc(j.text)}</div>
      <div class="center" style="padding-top:8px"><div class="mascot">${M.calm || ""}</div><h1 style="font-size:24px">งานนี้ Smith ยังทำไม่ได้</h1>
        <p class="muted" style="line-height:1.5">${esc(j.reason)}</p><span class="pill good">${I.check}ไม่คิดเงิน</span></div>
      <div class="grow"></div>
      <button class="btn" data-act="edit">แก้คำสั่ง</button>
      <a class="btn second" href="#/help">Smith ทำอะไรได้บ้าง</a>`;

  // ---------- a started job: running, done or failed
  async function jobScreen(id) {
    const r = await api("GET", `/api/jobs/${id}`);
    if (!r.ok) return render(notFound());
    const { job, credit } = r.data;
    state.job = job;
    if (["quoted", "rejected"].includes(job.status)) return go(`#/quote/${id}`);
    if (job.status === "running") {
      const box = document.getElementById("live");
      if (box?.dataset.job !== String(id)) render(runningView(job));
      else {
        document.getElementById("elapsed").innerHTML = elapsed(job);
        if (Number(box.dataset.n) !== job.progress.length) {
          box.innerHTML = liveSteps(job, Number(box.dataset.n));
          box.dataset.n = job.progress.length;
          document.getElementById("live-now").textContent = job.progress.at(-1)?.text || "";
        }
      }
      return poll(() => jobScreen(id), 3000);
    }
    if (job.status === "failed") return render(failedView(job, credit));
    if (job.status === "cancelled") return render(`${topbar(job.title)}<div class="center"><div class="mascot">${M.calm || ""}</div><h1 style="font-size:24px">ยกเลิกงานนี้แล้ว</h1><p class="muted">ไม่คิดเงิน</p></div>`);
    render(doneView(job, credit));
  }
  const elapsed = (j) => `${I.clock} ผ่านไป ${duration(j.startedAt)} · ประมาณ ${j.minutes} นาที`;
  // The agent's last few steps, newest last; steps after `seen` fade in. Before the first one arrives, the agreed plan.
  const liveSteps = (j, seen = j.progress.length) => {
    if (!j.progress.length) return j.steps.map((s, i) => `<div class="step"><span class="n">${i + 1}</span><span>${esc(s)}</span></div>`).join("");
    const from = Math.max(0, j.progress.length - 5);
    return j.progress.slice(from).map((p, k) => {
      const i = from + k;
      const now = i === j.progress.length - 1;
      return `<div class="step${i >= seen ? " enter" : ""}"><span class="n ${now ? "now" : "ok"}">${svg(now ? IC.bold.bolt : IC.bold.check, 16)}</span><span>${esc(p.text)}${now ? ` ${DOTS}` : ""}</span></div>`;
    }).join("");
  };
  const runningView = (j) => `${topbar(j.title)}
      <div class="center" style="padding-top:4px"><div class="mascot">${M.work || ""}</div>
        <h1 role="status">กำลังทำงาน ${DOTS}</h1>
        <span class="pill" id="elapsed">${elapsed(j)}</span></div>
      <div class="plan" id="live" data-job="${j.id}" data-n="${j.progress.length}">${liveSteps(j)}</div>
      <p class="sr" aria-live="polite" id="live-now">${esc(j.progress.at(-1)?.text || "")}</p>
      <div class="note">${I.info}<span>ปิดแอปได้เลย งานยังทำต่อ กลับมาดูผลได้ที่หน้าแรก</span></div>
      <div class="grow"></div>
      <div class="row" style="justify-content:space-between;padding:0 4px"><span class="muted">ราคาที่ตกลงไว้</span><span class="money">${baht(j.price)}</span></div>
      <a class="btn second" href="#/">กลับหน้าแรก</a>`;
  const optionCard = (o, i) => {
    const url = /^https?:\/\//.test(o.url) ? o.url : "";
    const picture = /^\/evidence\/[\w-]+\.(png|jpg|webp)$/.test(o.image) ? o.image : ""; // the product's picture, when its page had one
    const body = `${i ? "" : `<span class="pill good">${svg(IC.bold.check, 14)}แนะนำ</span>`}
      <span class="row" style="align-items:flex-start">${picture ? `<img class="shot" src="${esc(picture)}" alt="" loading="lazy">` : url ? siteTile(url) : `<span class="tile grey">${D.tag}</span>`}
        <span class="grow col" style="gap:4px;min-width:0"><span class="name">${esc(o.name)}</span>${o.price ? `<span class="price">${esc(o.price)}</span>` : ""}
          ${o.note ? `<span class="small muted">${esc(o.note)}</span>` : ""}${url ? `<span class="host">${esc(hostOf(url))}${svg(IC.bold.external, 14)}</span>` : ""}</span></span>`;
    const cls = `card pad col option${i ? "" : " best"}`;
    return url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${body}</a>` : `<div class="${cls}">${body}</div>`;
  };
  function doneView(j, credit) {
    const refundable = j.status === "done" && Date.now() - Date.parse(j.finishedAt) < 24 * 3600e3;
    return `${topbar(j.title)}
      <div class="center"><div class="mascot">${M.done || ""}</div><h1 role="status">เสร็จแล้ว!</h1></div>
      ${j.status === "refunded" ? `<div class="note good">${I.check}<span>คืนเงิน ${baht(j.price)} เป็นเครดิตแล้ว</span></div>` : ""}
      ${j.status === "refund_review" ? `<div class="note warn">${I.clock}<span>ทีมงานกำลังตรวจคำขอคืนเงิน ภายใน 1 วันทำการ</span></div>` : ""}
      <div class="card pad pre" style="font-size:16px;line-height:1.6">${esc(j.answer)}</div>
      ${j.options?.length ? `<div class="sect">ตัวเลือกที่เจอ</div>${j.options.map(optionCard).join("")}` : ""}
      <div class="sect">หลักฐานที่ตรวจเองได้</div>
      ${/^\/evidence\/[\w-]+\.png$/.test(j.evidence) ? `<a href="${esc(j.evidence)}" target="_blank" rel="noopener"><img class="evidence-img" src="${esc(j.evidence)}" alt="ภาพหน้าจอเว็บที่ Smith ใช้เป็นหลักฐาน แตะเพื่อดูภาพเต็ม"></a>` : ""}
      ${j.sources.length ? `<div class="card list">${j.sources.map(sourceRow).join("")}</div>` : '<p class="small muted" style="padding:0 4px">งานนี้ไม่มีลิงก์อ้างอิง</p>'}
      <div class="card list">
        <div class="item"><span class="grow muted">จ่ายจริง</span><span class="money">${j.status === "refunded" ? baht(0) : baht(j.price)}</span></div>
        <div class="item"><span class="grow muted">ใช้เวลา</span><span>${duration(j.startedAt, j.finishedAt)}</span></div>
        <div class="item"><span class="grow muted">เช็กข้อมูลเมื่อ</span><span>${esc(when(j.finishedAt))}</span></div>
        <div class="item"><span class="grow muted">เครดิตคงเหลือ</span><span>${baht(credit)}</span></div></div>
      <button class="btn" data-act="followup">สั่งต่อจากผลงานนี้</button>
      <button class="btn second" data-act="retry">ทำงานนี้อีกครั้ง</button>
      ${refundable ? `<a class="btn text-danger" href="#/refund/${j.id}">ผลไม่ตรง ขอเงินคืน</a>` : ""}`;
  }
  const failedView = (j, credit) => `${topbar(j.title)}
      <div class="center"><div class="mascot">${M.calm || ""}</div><h1 role="status" style="font-size:26px">งานนี้ยังไม่สำเร็จ</h1>
        <div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px"><span class="pill good">${I.check}ไม่คิดเงิน ฿0</span><span class="pill grey">เครดิตเท่าเดิม ${baht(credit)}</span></div></div>
      <div class="card pad col"><div class="mitr" style="font-weight:600">เกิดอะไรขึ้น</div><p class="pre muted" style="line-height:1.55">${esc(j.answer)}</p></div>
      <div class="grow"></div>
      <button class="btn" data-act="retry">ลองใหม่อีกครั้ง</button>
      <button class="btn second" data-act="edit">แก้คำสั่ง</button>`;

  // ---------- refund
  const REASONS = ["ราคาไม่ตรงกับหน้าเว็บ", "ลิงก์เปิดไม่ได้", "ไม่ใช่สิ่งที่ขอ", "ข้อมูลไม่ครบ", "อื่นๆ"];
  async function refundScreen(id) {
    const r = await api("GET", `/api/jobs/${id}`);
    if (!r.ok) return render(notFound());
    state.job = r.data.job;
    state.refund = { reasons: new Set(), note: "", error: false, result: null };
    render(refundView());
  }
  function refundView() {
    const j = state.job;
    const f = state.refund;
    if (f.result) {
      const [title, text, mascot] = {
        refunded: [`คืนเงินแล้ว ${baht(j.price)}`, "เครดิตเข้าแล้ว ใช้สั่งงานต่อได้ทันที ขอบคุณที่บอก เราจะเอาไปปรับ Smith", "done"],
        review: ["ส่งให้ทีมงานตรวจแล้ว", "เดือนนี้ใช้สิทธิ์คืนเงินอัตโนมัติครบ 3 ครั้งแล้ว ทีมงานจะตรวจให้ภายใน 1 วันทำการ", "calm"],
        expired: ["เกินเวลาขอคืนเงินแล้ว", "ขอคืนเงินได้ภายใน 24 ชั่วโมงหลังได้ผลงาน", "calm"],
        already: ["ขอคืนเงินงานนี้ไปแล้ว", "ดูสถานะได้ในหน้างาน", "calm"],
        not_charged: ["งานนี้ไม่ได้คิดเงิน", "ไม่ต้องขอคืน", "calm"],
      }[f.result.result] || ["ขอคืนเงินไม่ได้", "ลองใหม่อีกครั้ง", "calm"];
      return `${topbar("ขอเงินคืน", `#/job/${j.id}`)}
        <div class="grow"></div>
        <div class="center"><div class="mascot">${M[mascot] || ""}</div><h1 role="status" style="font-size:28px">${title}</h1>
          <p class="muted" style="line-height:1.55">${text}</p><span class="pill">${I.wallet} เครดิตคงเหลือ ${baht(f.result.credit)}</span></div>
        <div class="grow"></div>
        <a class="btn" href="#/">กลับหน้าแรก</a>`;
    }
    return `${topbar("ขอเงินคืน", `#/job/${j.id}`)}
      <div class="card pad row"><span class="tile">${D.receipt}</span><span class="col grow" style="gap:2px;min-width:0"><span class="t">${esc(j.title)}</span>
        <span class="small muted">จ่ายไป ${baht(j.price)} · เสร็จ${esc(when(j.finishedAt))}</span></span></div>
      <fieldset style="border:0;margin:0;padding:0"><legend class="sect" style="margin-bottom:10px">ผลไม่ตรงตรงไหน</legend>
        <div class="chips">${REASONS.map((x, i) => `<button class="chip" data-act="reason" data-arg="${i}" aria-pressed="${f.reasons.has(i)}">${esc(x)}</button>`).join("")}</div>
        ${f.error ? '<p role="alert" class="small" style="color:var(--rtxt);margin:10px 4px 0">เลือกอย่างน้อย 1 ข้อ เพื่อให้เราแก้ได้ถูกจุด</p>' : ""}</fieldset>
      <div class="col"><label for="note" class="small" style="font-weight:600;padding:0 4px">เล่าเพิ่มอีกนิด (ไม่บังคับ)</label>
        <textarea id="note" class="field" rows="3" maxlength="300" placeholder="เช่น ราคาในหน้าจองสูงกว่าที่สรุปไว้">${esc(f.note)}</textarea></div>
      <div class="note warn">${I.shield}<span>คืนเป็นเครดิตทันที เดือนละ 3 ครั้ง เกินนั้นทีมงานตรวจให้ภายใน 1 วันทำการ</span></div>
      <div class="grow"></div>
      <button class="btn" data-act="refund">คืนเงิน ${baht(j.price)}</button>`;
  }

  // ---------- history, credit, settings, help
  async function history() {
    state.jobs = (await api("GET", "/api/jobs")).data.jobs || [];
    render(`${topbar("งานทั้งหมด")}
      ${state.jobs.length
        ? `<div class="card list">${state.jobs.map(jobRow).join("")}</div>`
        : `<div class="grow"></div><div class="center"><div class="mascot">${M.small || ""}</div><h1 style="font-size:24px">ยังไม่มีงาน</h1><p class="muted">งานที่สั่งจะอยู่ตรงนี้ทั้งหมด</p></div><div class="grow"></div><a class="btn" href="#/">สั่งงานแรก</a>`}`);
  }

  const KIND = { start: "เครดิตเริ่มต้น", grant: "ทีมงานเติมเครดิต", release: "คืนเครดิต งานไม่สำเร็จ", refund: "คืนเงิน" };
  const ledgerRow = (e) => {
    const plus = e.amount > 0;
    const label = e.kind === "hold" ? e.title || "งาน" : e.title ? `${KIND[e.kind]}: ${e.title}` : KIND[e.kind] || e.kind;
    return `<div class="item"><span class="tile ${plus ? "good" : ""}">${plus ? D.refund : D.receipt}</span>
      <span class="grow col" style="gap:2px;min-width:0"><span class="t">${esc(label)}</span><span class="s">${esc(when(e.created_at))}</span></span>
      <span class="money ${plus ? "plus" : ""}">${plus ? "+" : "−"}${baht(Math.abs(e.amount))}</span></div>`;
  };
  async function wallet() {
    const [ledger, me] = await Promise.all([api("GET", "/api/ledger"), api("GET", "/api/me")]);
    const { credit, entries = [] } = ledger.data;
    render(`${topbar("เครดิต")}
      <div class="wallet-card"><div class="col grow" style="gap:2px"><div style="font-size:15px;font-weight:500">เครดิตคงเหลือ</div>
        <div class="big">${baht(credit)}</div><div class="small" style="font-weight:600">ใช้ได้ราว ${Math.floor(credit / 9)} งาน</div></div><span style="flex:none">${M.small || ""}</span></div>
      <div class="card pad col"><div class="row"><span class="tile">${D.wallet}</span><span class="col grow" style="gap:2px"><span class="t">ซื้อเครดิต</span>
        <span class="small muted">ช่วงทดลองยังซื้อในแอปไม่ได้ ทีมงานเติมให้</span></span></div>
        <p class="small muted">ส่งรหัสนี้ให้ทีมงานเพื่อขอเติมเครดิต</p>
        <div class="note" style="font-family:monospace;font-size:12px;user-select:all;overflow-wrap:anywhere">${esc(me.data.id)}</div></div>
      <div class="sect">รายการล่าสุด</div>
      <div class="card list">${entries.map(ledgerRow).join("") || '<div class="item muted">ยังไม่มีรายการ</div>'}</div>`);
  }

  async function settings() {
    const me = (await api("GET", "/api/me")).data;
    const row = (href, ic, label, right = "", tone = "") =>
      `<a class="item" href="${href}"><span class="tile ${tone}">${D[ic]}</span><span class="grow t" style="font-weight:500">${label}</span>${right}${I.chev}</a>`;
    render(`${topbar("ตั้งค่า")}
      <div class="card list">${row("#/wallet", "wallet", "เครดิต", `<span class="money">${baht(me.credit)}</span>`)}${row("#/history", "list", "งานทั้งหมด")}${row("#/help", "help", "ช่วยเหลือและข้อมูลส่วนตัว")}</div>
      ${me.login ? `<div class="card list"><button class="item" data-act="logout" style="width:100%;text-align:left"><span class="tile">${D.logout}</span><span class="grow t" style="font-weight:500">ออกจากระบบ</span></button></div>` : ""}
      <div class="card list">${row("#/delete", "trash", "ลบบัญชีและข้อมูลทั้งหมด", "", "bad")}</div>
      <div class="grow"></div>
      <p class="small muted" style="text-align:center">Smith Agent รุ่นทดลอง · รหัส ${esc(me.id.replace(/^web:/, "").slice(0, 8))}</p>`);
  }

  const FAQ = [
    ["Smith คิดเงินยังไง", "บอกราคาก่อนเริ่มทุกงาน หักจากเครดิตไม่เกินราคานั้น ถ้าทำไม่สำเร็จไม่คิดเงิน"],
    ["Smith จ่ายเงินหรือจองแทนฉันได้ไหม", "ไม่ได้ Smith ค้น เทียบ และส่งลิงก์ให้ คุณจ่ายหรือจองเองบนเว็บของร้าน"],
    ["ผลงานไม่ตรง ทำยังไง", "กดขอเงินคืนในหน้าผลงานภายใน 24 ชั่วโมง คืนเป็นเครดิตทันทีเดือนละ 3 ครั้ง เกินนั้นทีมงานตรวจให้ภายใน 1 วันทำการ"],
    ["ข้อมูลของฉันไปที่ไหน", "คำสั่งและหน้าเว็บที่ Agent อ่านจะส่งไปประมวลผลกับผู้ให้บริการ AI ในต่างประเทศ ภายใต้สัญญาที่ห้ามนำไปฝึก AI Smith ไม่ขายข้อมูลให้ใคร และคุณลบบัญชีพร้อมข้อมูลทั้งหมดได้เองในหน้าตั้งค่า"],
    ["ทำไมต้องรอหลายนาที", "Agent เปิดหลายเว็บเพื่อเทียบและเช็กข้อมูลจริง ปิดแอปไว้ได้ งานยังทำต่อ"],
  ];
  function help() {
    const cant = ["เข้าบัญชีธนาคารหรือจ่ายเงินแทนคุณ", "ล็อกอิน ยืนยันตัวตน หรือกรอก OTP แทนคุณ", "โทรศัพท์หรือไปทำธุระนอกบ้าน", "งานผิดกฎหมายหรือละเมิดคนอื่น"];
    render(`${topbar("ช่วยเหลือ", saved.get("consent") ? "#/settings" : "#/consent")}
      <div class="sect">คำถามที่พบบ่อย</div>
      <div class="card" style="padding:0 16px">${FAQ.map(([q, a]) => `<details class="faq"><summary>${q}${I.chevd}</summary><p>${a}</p></details>`).join("")}</div>
      <div class="note bad"><span class="col" style="gap:8px"><b>Smith ทำอะไรไม่ได้</b>${cant.map((t) => `<span class="row" style="gap:8px">${I.x}${t}</span>`).join("")}</span></div>
      <div class="row" style="justify-content:center;gap:16px"><a class="link-btn" href="#/privacy">นโยบายความเป็นส่วนตัว</a><a class="link-btn" href="#/terms">เงื่อนไขการใช้งาน</a></div>`);
  }

  function deleteScreen() {
    render(`${topbar("ลบบัญชี", "#/settings")}
      <div class="note bad">${I.trash}<span class="col" style="gap:2px"><b>ลบแล้วกู้คืนไม่ได้</b><span>งาน หลักฐาน และเครดิตที่เหลือจะหายไปทั้งหมด</span></span></div>
      <div class="col"><label for="confirm" class="small" style="font-weight:600">พิมพ์ “ลบบัญชี” เพื่อยืนยัน</label>
        <input id="confirm" class="field" autocomplete="off" placeholder="ลบบัญชี"></div>
      <div class="grow"></div>
      <button class="btn danger" data-act="delete" disabled>ลบบัญชีถาวร</button>
      <a class="btn second" href="#/settings">ยังไม่ลบ กลับไป</a>`);
  }

  const notFound = () => `${topbar("ไม่พบงาน")}<div class="center"><div class="mascot">${M.calm || ""}</div><h1 style="font-size:24px">ไม่พบงานนี้</h1></div>`;
  const errorView = (err) => `<div class="grow"></div><div class="center"><div class="mascot">${M.calm || ""}</div>
      <h1 style="font-size:24px">${err.message === "offline" ? "เชื่อมต่อไม่ได้" : "ระบบขัดข้อง"}</h1>
      <p class="muted">${err.message === "offline" ? "เช็กอินเทอร์เน็ตแล้วลองใหม่" : "ลองใหม่อีกครั้งในอีกสักครู่"}</p></div><div class="grow"></div>
      <button class="btn" data-act="reload">ลองใหม่</button>`;

  // ---------- actions (buttons carry data-act)
  // Busy is not disabled: the button keeps its colour, says what it is doing, and ignores more taps.
  const busy = (btn, label) => {
    btn.setAttribute("aria-busy", "true");
    if (label) btn.innerHTML = `${label} ${DOTS}`;
  };
  const actions = {
    async send(_, btn) {
      const text = state.draft.trim();
      if (!text) {
        document.getElementById("cmd")?.focus();
        return toast("พิมพ์งานที่อยากให้ทำก่อน");
      }
      busy(btn, "กำลังคิดราคา");
      const r = await api("POST", "/api/quote", { text });
      if (!r.ok) {
        render(homeView());
        return toast(r.status === 429 ? "สั่งงานบ่อยเกินไป รอสักครู่แล้วลองใหม่" : "ระบบขัดข้อง ลองใหม่อีกครั้ง");
      }
      state.draft = "";
      saved.set("draft", "");
      go(`#/quote/${r.data.job.id}`);
    },
    template(i) {
      state.draft = TEMPLATES[i].text;
      saved.set("draft", state.draft);
      render(homeView());
      const box = document.getElementById("cmd");
      box.focus();
      const at = box.value.indexOf("[");
      if (at >= 0) box.setSelectionRange(at, box.value.indexOf("]", at) + 1); // select the first blank to fill
    },
    async start(id, btn) {
      busy(btn, "กำลังเริ่ม");
      const r = await api("POST", `/api/jobs/${id}/start`);
      if (!r.ok && r.data.error === "credit") {
        toast("เครดิตไม่พอสำหรับงานนี้");
        return route();
      }
      go(`#/job/${id}`);
    },
    edit() {
      state.draft = state.job?.text || "";
      saved.set("draft", state.draft);
      go("#/");
    },
    followup() {
      state.draft = `ต่อจากงาน "${state.job?.title || ""}": `;
      saved.set("draft", state.draft);
      go("#/");
    },
    async retry(_, btn) {
      busy(btn, "กำลังคิดราคา");
      const r = await api("POST", "/api/quote", { text: state.job.text });
      if (!r.ok) return toast(r.status === 429 ? "สั่งงานบ่อยเกินไป รอสักครู่แล้วลองใหม่" : "ระบบขัดข้อง ลองใหม่อีกครั้ง"), route();
      go(`#/quote/${r.data.job.id}`);
    },
    reason(i) {
      const set = state.refund.reasons;
      set.has(i) ? set.delete(i) : set.add(i);
      state.refund.error = false;
      render(refundView());
    },
    async refund(_, btn) {
      const f = state.refund;
      if (!f.reasons.size) {
        f.error = true;
        return render(refundView());
      }
      busy(btn, "กำลังส่ง");
      const r = await api("POST", `/api/jobs/${state.job.id}/refund`, { reasons: [...f.reasons].map((i) => REASONS[i]), note: f.note });
      f.result = r.data;
      render(refundView());
    },
    next() {
      if (state.slide >= SLIDES.length - 1) return go("#/consent");
      state.slide += 1;
      welcome();
    },
    skip: () => go("#/consent"),
    consent() {
      saved.set("consent", { at: new Date().toISOString() });
      go("#/");
    },
    invite() {
      saved.set("invite", document.getElementById("invite").value.trim());
      go("#/");
    },
    async delete(_, btn) {
      busy(btn, "กำลังลบ");
      const r = await api("DELETE", "/api/me");
      if (!r.ok) return toast("ลบไม่สำเร็จ ลองใหม่อีกครั้ง"), route();
      token = newToken();
      ["token", "consent", "draft"].forEach((k) => saved.set(k, null));
      saved.set("token", token);
      state.slide = 0;
      state.draft = "";
      toast("ลบบัญชีและข้อมูลทั้งหมดแล้ว");
      go("#/welcome");
    },
    async "line-login"(_, btn) {
      busy(btn, "กำลังไปที่ LINE");
      const r = await api("POST", "/api/auth/line");
      if (!r.ok) return toast("ยังเข้าสู่ระบบด้วย LINE ไม่ได้ ลองใหม่อีกครั้ง"), login();
      location.href = r.data.url;
    },
    async logout(_, btn) {
      busy(btn);
      await api("POST", "/api/logout");
      token = newToken(); // a fresh device token: the old one stays unlinked on the server
      saved.set("token", token);
      go("#/login");
    },
    back: () => window.history.back(), // `history` here is the job-list screen
    reload: () => route(),
  };

  app.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled || el.getAttribute("aria-busy") === "true") return;
    e.preventDefault();
    try {
      await actions[el.dataset.act]?.(el.dataset.arg === undefined ? undefined : Number(el.dataset.arg), el);
    } catch (err) {
      if (err instanceof InviteNeeded) return go("#/invite");
      if (err instanceof LoginNeeded) return go("#/login");
      toast(err.message === "offline" ? "เชื่อมต่อไม่ได้ เช็กอินเทอร์เน็ตแล้วลองใหม่" : "ระบบขัดข้อง ลองใหม่อีกครั้ง");
      route();
    }
  });
  // A site without a saved logo, or a picture that is gone: drop the broken image (the globe under a logo then shows).
  app.addEventListener("error", (e) => e.target.matches?.(".logo, .shot") && e.target.remove(), true);
  app.addEventListener("input", (e) => {
    if (e.target.id === "cmd") {
      state.draft = e.target.value;
      saved.set("draft", state.draft);
    }
    if (e.target.id === "note") state.refund.note = e.target.value;
    if (e.target.id === "confirm") app.querySelector('[data-act="delete"]').disabled = e.target.value.trim() !== "ลบบัญชี";
  });

  // ---------- routing
  let renders = 0;
  function render(html) {
    renders++;
    app.innerHTML = html;
  }
  // Shown only when a screen takes longer than 150ms to load, shaped like the screen that is coming.
  const bone = (style) => `<span class="bone" style="${style}"></span>`;
  function skeleton(hash) {
    const rows = (n) => `<div class="card list">${`<div class="item">${bone("width:40px;height:40px;border-radius:12px")}<span class="grow col">${bone("height:14px;width:70%")}${bone("height:12px;width:40%")}</span></div>`.repeat(n)}</div>`;
    const bar = `<div class="topbar">${bone("width:44px;height:44px;border-radius:22px")}${bone("height:18px;width:45%")}<span class="gap44"></span></div>`;
    const body = /^#\/(job|quote|refund)\//.test(hash)
      ? `${bar}${bone("width:120px;height:120px;border-radius:60px;align-self:center")}${bone("height:28px;width:55%;align-self:center")}${bone("height:140px;border-radius:24px")}${rows(2)}`
      : /^#\/(history|wallet|settings)$/.test(hash)
        ? `${bar}${rows(5)}`
        : `<div class="topbar">${bone("width:44px;height:44px;border-radius:22px")}${bone("width:96px;height:40px;border-radius:20px")}</div>
          ${bone("height:34px;width:65%")}${bone("height:34px;width:45%;margin-top:-6px")}${bone("height:176px;border-radius:26px")}${rows(3)}`;
    return `<p class="sr" role="status">กำลังโหลด</p>${body}`;
  }
  const ROUTES = [
    [/^#\/welcome$/, welcome],
    [/^#\/consent$/, consent],
    [/^#\/invite$/, invite],
    [/^#\/login(\?e=1)?$/, login],
    [/^#\/privacy$/, privacy],
    [/^#\/terms$/, terms],
    [/^#\/quote\/(\d+)$/, quoteScreen],
    [/^#\/job\/(\d+)$/, jobScreen],
    [/^#\/refund\/(\d+)$/, refundScreen],
    [/^#\/history$/, history],
    [/^#\/wallet$/, wallet],
    [/^#\/settings$/, settings],
    [/^#\/help$/, help],
    [/^#\/delete$/, deleteScreen],
    [/^(#\/?|#\/home)?$/, home],
  ];
  async function route() {
    clearTimeout(poller);
    const hash = location.hash;
    if (!saved.get("consent") && !/^#\/(welcome|consent|help|invite|privacy|terms|login)/.test(hash)) return go("#/welcome");
    const hit = ROUTES.find(([re]) => re.test(hash));
    if (!hit) return go("#/");
    const arg = hit[0].exec(hash)[1];
    const before = renders;
    const slow = setTimeout(() => renders === before && render(skeleton(hash)), 150);
    try {
      await hit[1](arg && /^\d+$/.test(arg) ? Number(arg) : undefined);
      window.scrollTo(0, 0);
    } catch (err) {
      if (err instanceof Stale) return;
      if (err instanceof InviteNeeded) return go("#/invite");
      if (err instanceof LoginNeeded) return go("#/login");
      render(errorView(err));
    } finally {
      clearTimeout(slow);
    }
  }
  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("pageshow", (e) => e.persisted && route()); // back from LINE Login: drop the busy button
  route();
})();
