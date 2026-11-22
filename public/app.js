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

  // Icons come from icons.js: bold for controls and text, filled inside tiles and chips. The LINE mark is LINE's own.
  const IC = window.ICONS || { bold: {}, fill: {}, line: "" };
  const svg = (d, size = 20, box = 256) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}" fill="currentColor">${d || ""}</svg>`;
  const I = Object.fromEntries(Object.entries(IC.bold).map(([k, d]) => [k, svg(d)]));
  const D = Object.fromEntries(Object.entries(IC.fill).map(([k, d]) => [k, svg(d, 22)]));
  const LINE_MARK = svg(IC.line, 24, 24);
  const CLOUDS = '<div class="clouds" aria-hidden="true"></div>';
  const SPARK = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 20 20" fill="currentColor"><path d="M10 0l2.2 7.8L20 10l-7.8 2.2L10 20l-2.2-7.8L0 10l7.8-2.2z"/></svg>';
  const SPARKS = `<span class="sparks">${SPARK.repeat(3)}</span>`;
  const DOTS = '<span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>';

  // ---------- state and server calls
  const state = { me: null, jobs: [], job: null, draft: saved.get("draft") || "", slide: 0, refund: null, filter: 0 };
  let poller;
  let gen = 0; // bumped on every route change: loads and polls from an older screen stop instead of painting

  class InviteNeeded extends Error {}
  // The service worker saves what the user opened and serves it when there is no connection. The bar says so, so old numbers are not read as new.
  function offlineBar(on) {
    let bar = document.getElementById("offline-bar");
    if (!on) return bar?.remove();
    if (bar) return;
    document.body.insertAdjacentHTML("afterbegin", '<div id="offline-bar" role="status">ออฟไลน์ แสดงข้อมูลที่เคยเปิดไว้ อาจไม่ใช่ข้อมูลล่าสุด</div>');
  }
  const forgetSaved = () => window.caches?.keys().then((names) => Promise.all(names.filter((n) => n.startsWith("smith-data")).map((n) => caches.delete(n)))).catch(() => {}); // the next person on this phone must not see these jobs
  class LoginNeeded extends Error {}
  class RoundFull extends Error {} // the server takes no new accounts in this test round
  class Stale extends Error {} // the user moved to another screen while this loaded
  async function api(method, path, body) {
    const at = gen;
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
    if (method === "GET" && gen !== at) throw new Stale(); // a late load must not paint over the newer screen
    if (method === "GET") offlineBar(res.headers.get("X-Smith-Offline") === "1"); // the service worker answered from what was opened before
    if (res.status === 403 && data.error === "invite") throw new InviteNeeded();
    if (res.status === 401 && data.error === "login") throw new LoginNeeded();
    if (res.status === 403 && data.error === "full") throw new RoundFull();
    return { ok: res.ok, status: res.status, data };
  }

  // Refresh a screen every few seconds. A network blip retries; leaving the screen stops it.
  const poll = (fn, ms, at = gen) => {
    poller = setTimeout(() => at === gen && fn().catch((e) => e instanceof Stale || (at === gen && poll(fn, 5000, at))), ms);
  };

  function toast(msg) {
    document.querySelector(".toast")?.remove();
    const el = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    el.setAttribute("role", "status");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ---------- shared pieces
  const topbar = (title, back = "#/", right = '<span class="gap44"></span>') =>
    `<div class="topbar"><a class="icon-btn" href="${back}" aria-label="กลับ">${I.back}</a><div class="title">${esc(title)}</div>${right}</div>`;
  const STATUS = {
    quoted: ["รอเริ่ม", "grey"],
    running: ["กำลังทำ", ""],
    done: ["เสร็จแล้ว", "good"],
    failed: ["ไม่สำเร็จ ไม่คิดเงิน", "bad"],
    refunded: ["คืนเงินแล้ว", "warn"],
    refund_review: ["รอตรวจคืนเงิน", "warn"],
    cancelled: ["ยกเลิกแล้ว", "grey"],
    rejected: ["Smith ทำไม่ได้", "grey"],
  };
  // What kind of job it is, from the words in it: the icon says the kind, its colour says the status. First match wins,
  // so a cheap flight is a flight and a cheap restaurant is a restaurant, not a price check.
  const KINDS = [
    ["plane", /ตั๋ว|เที่ยวบิน|เครื่องบิน|สายการบิน|บินไป|ที่พัก|โรงแรม|ทริป|เที่ยว|flight|hotel/i],
    ["receipt", /ราคาส่ง|ขายส่ง|เข้าร้าน|สต็อก/i],
    ["food", /ร้านอาหาร|อาหาร|ร้านอร่อย|คาเฟ่|กาแฟ|ของกิน|บุฟเฟ่ต์|ร้านกิน|ร้าน.{0,8}(กิน|อร่อย)/i],
    ["doc", /ข่าว|สรุป|บทความ|อ่าน|รีวิว/i],
    ["tag", /ราคา|เทียบ|ซื้อ|ถูก|โค้ด|ส่วนลด|โปร|shopee|lazada/i],
  ];
  const kindOf = (text) => KINDS.find(([, re]) => re.test(text || ""))?.[0] || "sparkle";
  const jobRow = (j) => {
    const [label, tone] = STATUS[j.status] || ["", "grey"];
    const href = j.status === "quoted" || j.status === "rejected" ? `#/quote/${j.id}` : `#/job/${j.id}`;
    const charged = ["done", "refund_review", "running"].includes(j.status);
    const top = j.options?.[0];
    // A finished job shows what it found: the first option's picture, or the logo of the site it came from.
    const art = j.status !== "done" ? "" : picture(top) ? `<img class="logo photo" src="${esc(picture(top))}" alt="" loading="lazy">` : logoImg(brandOf(top) || hostOf(j.sources?.[0]?.url));
    return `<a class="item" href="${href}"><span class="tile bare ${tone}">${svg(IC.fill[kindOf(`${j.title} ${j.text}`)], 28)}${art}</span>
      <span class="grow col" style="gap:2px;min-width:0"><span class="t">${esc(j.title || j.text)}</span>
      <span class="s">${esc(when(j.createdAt))} · ${label}${j.status === "running" ? ` ${DOTS}` : ""}</span></span>
      ${charged ? `<span class="money">${baht(j.price)}</span>` : ""}</a>`;
  };
  // Pictures sit on top of an icon: when one is missing or fails to load it is removed and the icon shows.
  const logoImg = (host) => (host && pref("pictures") ? `<img class="logo" src="/logo/${esc(host)}.png" alt="" loading="lazy">` : "");
  const picture = (o) => (pref("pictures") && /^\/evidence\/[\w-]+\.(png|jpg|webp)$/.test(o?.image) ? o.image : ""); // the product's picture, when its page had one
  const siteTile = (url) => `<span class="tile">${D.link}${logoImg(hostOf(url))}</span>`;
  const brandOf = (o) => (/^[a-z0-9.-]+$/.test(o?.brand || "") ? o.brand : hostOf(o?.url)); // `|| ""`: test(undefined) checks the text "undefined" // whose logo an option carries: the brand's, else its page's
  const sourceRow = (s) =>
    /^https?:\/\//.test(s.url)
      ? `<a class="source" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${siteTile(s.url)}
        <span class="grow col" style="gap:2px;min-width:0"><span class="t" style="font-size:14px">${esc(s.title || hostOf(s.url))}</span><span class="host">${esc(hostOf(s.url))}</span></span>${I.external}</a>`
      : "";

  // ---------- onboarding
  // A prop floats around the slide's mascot: placed by `at`, tilted by `r` degrees, arriving `d` seconds in.
  const prop = (at, r, d, html) => `<span class="prop" style="${at};--d:${d}s"><span style="--r:${r}deg">${html}</span></span>`;
  const say = (tone, text) => `<span class="say ${tone}">${text}</span>`;
  const bars = (n) => '<i class="bar"></i>'.repeat(n);
  const SLIDES = [
    {
      m: "idle", h: "บอกสิ่งที่อยากได้<br>แล้วปล่อยให้ Smith<br>ไปทำแทนคุณ", p: "เทียบราคาของชิ้นใหญ่ หาตั๋ว หาที่พัก หาราคาส่ง พิมพ์มาเหมือนคุยกับเพื่อน",
      props: prop("left:0;top:6px", -7, 0.25, say("cor", "หาตั๋วไปเชียงใหม่")) + prop("right:0;top:44px", 6, 0.4, say("yel", "เทียบราคาหูฟัง")) + prop("left:6%;bottom:2px", 4, 0.55, say("grn", "หาที่พักภูเก็ต")),
    },
    {
      m: "work", h: "Smith บอกแผน<br>และราคาก่อนลงมือ", p: "จ่ายไม่เกินราคาที่บอก ไม่สำเร็จ ไม่คิดเงิน",
      props: prop("right:2%;top:10px", 9, 0.25, '<span class="sticker">฿12</span>') + prop("left:0;top:54px", -6, 0.4, `<span class="mini">${`<span class="row">${svg(IC.fill.check, 16)}<i class="bar"></i></span>`.repeat(3)}</span>`),
    },
    {
      m: "done", h: "ผลงานมีลิงก์จริง<br>ให้เปิดตรวจเองได้", p: "มีภาพหน้าจอเมื่อเปิดหน้าเว็บได้ ผลไม่ตรง ขอเงินคืนได้ใน 24 ชั่วโมง", sparks: true,
      props: prop("left:0;top:30px", -8, 0.25, `<span class="mini"><i class="pic"></i>${bars(2)}</span>`) + prop("right:0;top:70px", 7, 0.4, `<span class="say blu">${svg(IC.bold.link, 16)}ลิงก์หลักฐาน</span>`) + prop("right:8%;top:0", -5, 0.55, `<span class="say grn">${svg(IC.fill.check, 16)}คืนเงินได้</span>`),
    },
  ];
  function welcome() {
    const s = SLIDES[Math.min(state.slide, SLIDES.length - 1)];
    const last = state.slide >= SLIDES.length - 1;
    render(`${CLOUDS}<div class="row" style="min-height:40px"><span style="width:64px"></span>
        <div class="slide-dots grow" aria-hidden="true">${SLIDES.map((_, i) => `<span class="${i === state.slide ? "on" : ""}"></span>`).join("")}</div>
        <span style="width:64px;text-align:right">${last ? "" : '<button class="pill-btn" data-act="skip">ข้าม</button>'}</span></div>
      <div class="grow"></div>
      <div class="center" style="gap:14px"><div class="scene"><div class="mascot" style="min-height:150px">${M[s.m] || ""}${s.sparks ? SPARKS : ""}</div>${s.props}</div>
        <h1 style="font-size:30px">${s.h}</h1><p class="muted" style="font-size:16px;line-height:1.5">${s.p}</p></div>
      <div class="grow"></div>
      <button class="btn" data-act="next">${last ? "เริ่มเลย" : "ถัดไป"}</button>`);
  }

  function consent() {
    render(`${CLOUDS}<div class="center" style="padding-top:12px"><div class="mascot" style="min-height:96px">${M.small || ""}</div>
        <h1 style="font-size:25px">ก่อนเริ่ม ขออนุญาตหน่อยนะ</h1></div>
      <div class="note" style="background:var(--soft)">${I.info}<span class="col" style="gap:6px"><b>จำเป็นต่อการใช้งาน</b>
        <span>ใช้คำสั่งและผลงานเพื่อทำงานให้คุณ ไม่ขายข้อมูลให้ใคร และลบบัญชีพร้อมข้อมูลทั้งหมดได้เองในหน้าตั้งค่า</span>
        <span>คำสั่งและหน้าเว็บที่ Smith อ่าน จะส่งไปประมวลผลกับผู้ให้บริการ AI ในต่างประเทศ</span></span></div>
      <div class="note">${I.lock}<span>อย่าพิมพ์รหัสผ่าน เลขบัตร หรือ OTP ลงในคำสั่ง Smith ไม่ต้องใช้ข้อมูลเหล่านี้</span></div>
      <a class="link-btn" href="#/privacy" style="align-self:center">อ่านนโยบายความเป็นส่วนตัว</a>
      <div class="grow"></div>
      <button class="btn" data-act="consent">ยอมรับและไปต่อ</button>`);
  }

  function invite() {
    render(`${CLOUDS}<div class="center" style="padding-top:24px"><div class="mascot">${M.small || ""}</div><h1 style="font-size:25px">ใส่รหัสเชิญ</h1>
        <p class="muted">ช่วงทดลอง Smith เปิดให้เฉพาะคนที่ได้รับรหัสจากทีมงาน</p></div>
      <label class="sr" for="invite">รหัสเชิญ</label>
      <input id="invite" class="field" autocomplete="off" autocapitalize="off" placeholder="รหัสเชิญ" value="${esc(saved.get("invite") || "")}">
      ${saved.get("invite") ? '<p role="alert" class="small" style="color:var(--rtxt);padding:0 4px">รหัสนี้ใช้ไม่ได้ ลองเช็กกับทีมงานอีกครั้ง</p>' : ""}
      <div class="grow"></div>
      <button class="btn" data-act="invite">ไปต่อ</button>`);
  }

  function roundFull() {
    render(`${CLOUDS}<div class="center" style="padding-top:24px"><div class="mascot">${M.small || ""}</div><h1 style="font-size:25px">รอบทดลองเต็มแล้ว</h1>
        <p class="muted">ขอบคุณที่สนใจครับ ตอนนี้ Smith รับผู้ทดลองครบแล้ว ทีมงานจะแจ้งเมื่อเปิดรอบถัดไป</p></div>`);
  }

  // ---------- sign in (only when the server has LINE Login set up)
  function login() {
    const failed = location.hash.includes("e=1");
    render(`${CLOUDS}<div class="grow"></div>
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
    ["ใครได้รับข้อมูล", ["ผู้ให้บริการ AI (Anthropic สหรัฐอเมริกา) ประมวลผลคำสั่งและหน้าเว็บที่ Smith อ่าน", "LINE เมื่อคุณเข้าสู่ระบบหรือรับผลงานทาง LINE", "บริการโลโก้เว็บไซต์ของ Google ได้รับเฉพาะชื่อเว็บไซต์ที่อยู่ในผลงาน ไม่มีข้อมูลที่ระบุตัวคุณ", "ผู้ให้บริการเซิร์ฟเวอร์ที่ Smith ใช้", "เราไม่ขายข้อมูลให้ใคร"]],
    ["เก็บนานแค่ไหน", ["เก็บจนกว่าคุณจะลบบัญชี ซึ่งทำได้เองทันทีในหน้าตั้งค่า งาน หลักฐาน และประวัติเครดิตจะถูกลบทั้งหมด", "เมื่อจบช่วงทดลอง เราอาจลบข้อมูลทั้งหมดของช่วงทดลอง"]],
    ["สิทธิ์ของคุณ", ["ขอดูหรือขอสำเนาข้อมูล ขอแก้ไข ขอลบ และคัดค้านการใช้ข้อมูล", "ร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (สคส.) ได้"]],
    ["ความปลอดภัย", ["ภาพหลักฐานตั้งชื่อแบบสุ่มที่เดาไม่ได้", "ทีมงานเข้าถึงข้อมูลเฉพาะเท่าที่จำเป็นต่อการดูแลบริการ"]],
  ];
  const TERMS = [
    ["Smith ทำอะไร", ["Smith ค้น เทียบ และสรุปข้อมูลจากเว็บไซต์สาธารณะตามคำสั่งของคุณ", "Smith ไม่จ่ายเงิน ไม่ล็อกอิน และไม่จองแทนคุณ"]],
    ["ราคาและเครดิต", ["Smith บอกราคาก่อนเริ่มทุกงาน และหักเครดิตไม่เกินราคานั้น", "งานที่ทำไม่สำเร็จไม่คิดเงิน", "เครดิตใช้ได้เฉพาะใน Smith แลกเป็นเงินสดไม่ได้ และหายไปเมื่อลบบัญชี"]],
    ["การขอเงินคืน", ["ขอได้ภายใน 24 ชั่วโมงหลังได้ผลงาน คืนเป็นเครดิตอัตโนมัติเดือนละ 3 ครั้ง ถ้าเหตุผลคือราคาไม่ตรงกับหน้าเว็บ คืนอัตโนมัติได้เดือนละ 5 ครั้ง เกินนั้นทีมงานตรวจให้ภายใน 1 วันทำการ"]],
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
  // One example per buyer group in founder/customer.json, all where the saving is worth the fee (founder/pricing.md:
  // the fee does not pay off on an item under ฿100): big items, trips, flights, and stock for a small shop.
  const TEMPLATES = [
    { label: "เทียบราคาของชิ้นใหญ่", icon: "tag", tone: "cor", text: "เทียบราคา [ชื่อสินค้าและรุ่น] จากหลายร้าน พร้อมลิงก์และโค้ดส่วนลดถ้ามี" },
    { label: "หาตั๋วเครื่องบิน", icon: "plane", tone: "blu", text: "หาตั๋วเครื่องบินไป [เมือง] วันที่ [วัน] กลับวันที่ [วัน] ราคาถูกสุด รวมกระเป๋า" },
    { label: "หาที่พักวันหยุดยาว", icon: "plane", tone: "grn", text: "หาที่พักที่ [จังหวัด] วันที่ [วัน] ถึง [วัน] สำหรับ [จำนวน] คน งบไม่เกิน [บาท] ต่อคืน" },
    { label: "หาราคาส่งเข้าร้าน", icon: "receipt", tone: "yel", text: "หาราคาส่ง [สินค้า] จำนวน [จำนวน] ชิ้น จากหลายร้าน รวมค่าส่ง" },
  ];
  async function home() {
    const [me, list] = await Promise.all([api("GET", "/api/me"), api("GET", "/api/jobs")]);
    state.me = me.data;
    state.jobs = list.data.jobs || [];
    render(homeView());
    fitCmd(document.getElementById("cmd")); // a saved draft opens at its full height
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
  // The home screen is a grid of cards, each fed by real data only: the job running now (or the price list), a big
  // "new job" card, the latest result, the latest jobs, and this month's spend. The composer is docked below them.
  const thisMonth = (iso) => { const d = new Date(iso), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); };
  const kindIcon = (j, size = 22) => { const [, tone] = STATUS[j.status] || ["", "grey"]; return `<span class="kind ${tone}">${svg(IC.fill[kindOf(`${j.title} ${j.text}`)], size)}</span>`; };
  function homeParts() {
    const running = state.jobs.find((j) => j.status === "running");
    const done = state.jobs.find((j) => ["done", "refund_review", "refunded"].includes(j.status));
    const recent = state.jobs.filter((j) => !["rejected", "cancelled"].includes(j.status) && j !== running && j !== done).slice(0, 3);
    const month = state.jobs.filter((j) => thisMonth(j.createdAt));
    const spent = month.filter((j) => ["done", "refund_review"].includes(j.status)).reduce((s, j) => s + j.price, 0);
    const ok = month.filter((j) => ["done", "refund_review", "refunded"].includes(j.status)).length;
    const failed = month.filter((j) => j.status === "failed").length;
    const prices = state.me.prices || {};
    const now = running
      ? `<a class="tile-card soft" href="#/job/${running.id}"><span class="h">กำลังทำ</span><span class="s clamp">${esc(running.title || running.text)}</span><span class="grow"></span>
          <span class="big">${(running.progress || []).filter((x) => x.host).length}<small> เว็บที่อ่าน</small></span><span class="bar" aria-hidden="true"><i></i></span>
          <span class="s link clamp">${esc(running.progress?.at(-1)?.text || "กำลังเริ่มงาน")}</span></a>`
      : `<a class="tile-card soft" href="#/help"><span class="h">ราคาต่องาน</span><span class="s">บอกก่อนเริ่มทุกงาน ไม่สำเร็จไม่คิดเงิน</span><span class="grow"></span>
          <span class="big">${baht(prices.M || 9)}</span><span class="s">งานกลาง · เล็ก ${baht(prices.S || 5)} · ใหญ่ ${baht(prices.L || 15)}</span></a>`;
    const last = done
      ? `<div class="tile-card blue"><span class="h">เสร็จแล้ว</span><span class="s clamp">${esc(done.title || done.text)}</span><span class="grow"></span>
          <span class="kv"><span>อ่านเว็บ</span><b>${done.coverage?.hosts?.length || done.sources?.length || 0} เว็บ</b></span>
          <span class="kv"><span>ใช้เวลา</span><b>${duration(done.startedAt, done.finishedAt)}</b></span>
          <a class="mini-btn" href="#/job/${done.id}">ดูผลงาน</a></div>`
      : `<div class="tile-card blue"><span class="h">ผลงาน</span><span class="s">งานที่เสร็จจะอยู่ตรงนี้ พร้อมลิงก์ให้เปิดตรวจเอง</span><span class="grow"></span>
          <span class="kv"><span>ไม่สำเร็จ</span><b>ไม่คิดเงิน</b></span><span class="kv"><span>ผลไม่ตรง</span><b>ขอคืนได้</b></span></div>`;
    const list = recent.length
      ? recent.map((j) => `<a class="mini-row" href="${["quoted", "rejected"].includes(j.status) ? `#/quote/${j.id}` : `#/job/${j.id}`}">${kindIcon(j)}<span class="clamp1">${esc(j.title || j.text)}</span></a>`).join("")
      : '<span class="s">ยังไม่มีงานอื่น ลองแตะตัวอย่างด้านล่าง</span>';
    return {
      "home-pill": `<a class="jobs-pill" href="#/history"><span class="dot${running ? " on" : ""}" aria-hidden="true"></span>งานของฉัน</a>`,
      "home-credit": `<a class="credit-chip" href="#/wallet" aria-label="เครดิต ${baht(state.me.credit)}">${I.wallet} ${baht(state.me.credit)}</a>`,
      "home-grid": `<div class="bento">
        ${now}
        <button class="tile-card start" data-act="compose"><span class="pic">${M.small || ""}</span><span class="cta">สั่งงาน<br>ใหม่เลย!</span></button>
        ${last}
        <div class="tile-card line"><span class="h">งานล่าสุด</span>${list}<span class="grow"></span><a class="s link" href="#/history">ดูทั้งหมด</a></div>
        <a class="tile-card line wide" href="#/history"><span class="col" style="gap:0"><span class="h">ใช้ไปเดือนนี้</span><span class="big">${baht(spent)}</span></span>
          <span class="grow col" style="gap:6px"><span class="kv"><span>งานสำเร็จ</span><b>${ok} งาน</b></span><span class="kv"><span>ไม่สำเร็จ ${failed} งาน</span><b class="good">ไม่คิดเงิน</b></span></span></a>
      </div>`,
    };
  }
  function homeView() {
    const slot = Object.fromEntries(Object.entries(homeParts()).map(([id, html]) => [id, `<div class="slot" id="${id}">${html}</div>`]));
    return `<div class="topbar"><a class="icon-btn" href="#/settings" aria-label="ตั้งค่า">${I.person}</a>${slot["home-pill"]}${slot["home-credit"]}</div>
      <h1 class="sr">Smith</h1>
      ${slot["home-grid"]}
      <div class="grow"></div>
      <div class="dock">
        <span class="grab" aria-hidden="true"></span>
        <div class="row" style="align-items:flex-end;gap:8px">
          <label class="sr" for="cmd">พิมพ์งานที่อยากให้ทำ</label>
          <textarea id="cmd" class="field" rows="1" maxlength="1000" placeholder="อยากให้ Smith ช่วยอะไร…">${esc(state.draft)}</textarea>
          <button class="send" data-act="send">สั่งงาน</button>
        </div>
        <div class="hscroll" role="group" aria-label="ตัวอย่างงาน">${TEMPLATES.map((t, i) => `<button class="chip ${t.tone}" data-act="template" data-arg="${i}">${svg(IC.fill[t.icon], 20)}${esc(t.label)}</button>`).join("")}</div>
      </div>`;
  }
  // The composer is one line until there is more to show; it grows with the text, up to a few lines.
  const fitCmd = (box) => { if (!box) return; box.style.height = "auto"; box.style.height = `${Math.min(box.scrollHeight, 132)}px`; };

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
      <div class="plan"><div class="mitr" style="font-weight:600;font-size:17px">Smith จะทำแบบนี้</div>
        ${j.steps.map((s, i) => `<div class="step"><span class="n bare">${i + 1}</span><span>${esc(s)}</span></div>`).join("")}
        <div class="small muted">Smith จะไม่จ่ายเงิน ไม่ล็อกอิน และไม่จองแทนคุณ</div></div>
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
    if (document.getElementById("live")) fresh = true; // the job just finished while the user watched: let the result arrive
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
      return `<div class="step${i >= seen ? " enter" : ""}"><span class="n ${now ? "now" : "ok"}">${svg(now ? IC.bold.bolt : IC.bold.check, 16)}${logoImg(p.host)}</span><span>${esc(p.text)}${now ? ` ${DOTS}` : ""}</span></div>`;
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
    const body = `${i ? "" : `<span class="pill good">${svg(IC.bold.check, 14)}แนะนำ</span>`}
      <span class="row" style="align-items:flex-start">${picture(o)
        ? `<span class="shotbox"><img class="shot" src="${esc(picture(o))}" alt="" loading="lazy">${logoImg(brandOf(o)).replace('"logo"', '"logo badge"')}</span>`
        : `<span class="tile${brandOf(o) ? "" : " grey"}">${brandOf(o) ? D.link : D.tag}${logoImg(brandOf(o))}</span>`}
        <span class="grow col" style="gap:4px;min-width:0"><span class="name">${esc(o.name)}</span>${o.price ? `<span class="price">${esc(o.price)}</span>` : ""}
          ${o.note ? `<span class="small muted">${esc(o.note)}</span>` : ""}${url ? `<span class="host">${esc(hostOf(url))}${svg(IC.bold.external, 14)}</span>` : ""}</span></span>`;
    const cls = `card pad col option${i ? "" : " best"}`;
    return url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${body}</a>` : `<div class="${cls}">${body}</div>`;
  };
  const codeRow = (c, i) => `<div class="card pad row code"><div class="grow col" style="gap:3px;min-width:0">
      <span class="codetxt">${esc(c.code)}</span><span class="small muted">${esc([c.shop, c.note].filter(Boolean).join(" · "))}</span>
      ${/^https?:\/\//.test(c.url) ? `<a class="host" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">เจอที่ ${esc(hostOf(c.url))}${svg(IC.bold.external, 14)}</a>` : ""}</div>
      <button class="pill-btn" data-act="copy" data-arg="${i}">${svg(IC.bold.copy, 16)}คัดลอก</button></div>`;
  // What Smith opened for this job: how many searches and pages, which sites, and which it could not read.
  const coverageCard = (c) => {
    if (!c || (!c.searches && !c.pages)) return "";
    const chips = (c.hosts || []).map((h) => `<span class="hostchip">${pref("pictures") ? `<img class="mini-logo" src="/logo/${esc(h)}.png" alt="">` : ""}${esc(h)}</span>`).join("");
    return `<div class="card pad col"><span class="sect" style="padding:0;font-size:16px">Smith อ่านอะไรบ้าง</span>
      <span class="small muted">ค้น ${Number(c.searches) || 0} ครั้ง · อ่าน ${Number(c.pages) || 0} หน้า จาก ${(c.hosts || []).length} เว็บ</span>
      ${chips ? `<span class="chipsrow">${chips}</span>` : ""}
      ${c.blocked?.length ? `<div class="note warn">${I.info}<span>อ่านไม่ได้: ${c.blocked.map(esc).join(", ")} ราคาจากเว็บนี้อาจไม่อยู่ในผล</span></div>` : ""}</div>`;
  };
  // The result as plain text for a friend or a LINE group (offer item F): names, prices and shop links only. The
  // screenshot stays private, and the line about when it was checked travels with the prices.
  const shareText = (j) => [
    `Smith เช็กให้: ${j.title}`,
    ...(j.options?.length
      ? j.options.map((o, i) => [`${i + 1}. ${o.name}${o.price ? ` · ${o.price}` : ""}`, /^https?:\/\//.test(o.url) ? o.url : ""].filter(Boolean).join("\n"))
      : [String(j.answer || "").slice(0, 400)]),
    ...(j.codes?.length ? [`โค้ดที่เจอบนหน้าเว็บ (อาจหมดอายุ): ${j.codes.map((c) => c.code).join(", ")}`] : []),
    `เช็กเมื่อ ${new Date(j.finishedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short" })} ${clock(new Date(j.finishedAt))} ราคาอาจเปลี่ยน ตรวจที่ลิงก์ก่อนซื้อ`, // read later, so a date, not "a minute ago"
  ].join("\n");
  function doneView(j, credit) {
    const refundable = j.status === "done" && Date.now() - Date.parse(j.finishedAt) < 24 * 3600e3;
    // The phone reads the result aloud (its own Thai voice): for hands-busy moments and for people who find reading hard.
    const listen = "speechSynthesis" in window ? `<button class="icon-btn" data-act="speak" aria-label="ฟังผลงาน" aria-pressed="false">${I.speaker}</button>` : undefined;
    return `${topbar(j.title, "#/", listen)}
      <div class="center"><div class="mascot">${M.done || ""}${SPARKS}</div><h1 role="status">เสร็จแล้ว!</h1></div>
      ${j.status === "refunded" ? `<div class="note good">${I.check}<span>คืนเงิน ${baht(j.price)} เป็นเครดิตแล้ว</span></div>` : ""}
      ${j.status === "refund_review" ? `<div class="note warn">${I.clock}<span>ทีมงานกำลังตรวจคำขอคืนเงิน ภายใน 1 วันทำการ</span></div>` : ""}
      <div class="card pad pre" style="font-size:16px;line-height:1.6">${esc(j.answer)}</div>
      ${j.options?.length ? `<div class="sect">ตัวเลือกที่เจอ</div>${j.options.map(optionCard).join("")}` : ""}
      ${j.codes?.length ? `<div class="sect">โค้ดส่วนลดที่เจอ</div><p class="small muted" style="padding:0 4px;margin-top:-6px">เจอบนหน้าเว็บ อาจหมดอายุ ตรวจก่อนใช้</p>${j.codes.map(codeRow).join("")}` : ""}
      <div class="sect">หลักฐานที่ตรวจเองได้</div>
      ${/^\/evidence\/[\w-]+\.png$/.test(j.evidence) ? `<a href="${esc(j.evidence)}" target="_blank" rel="noopener"><img class="evidence-img" src="${esc(j.evidence)}" alt="ภาพหน้าจอเว็บที่ Smith ใช้เป็นหลักฐาน แตะเพื่อดูภาพเต็ม"></a>` : ""}
      ${j.sources.length ? `<div class="card list">${j.sources.map(sourceRow).join("")}</div>` : '<p class="small muted" style="padding:0 4px">งานนี้ไม่มีลิงก์อ้างอิง</p>'}
      ${coverageCard(j.coverage)}
      <div class="card list">
        <div class="item"><span class="grow muted">จ่ายจริง</span><span class="money">${j.status === "refunded" ? baht(0) : baht(j.price)}</span></div>
        <div class="item"><span class="grow muted">ใช้เวลา</span><span>${duration(j.startedAt, j.finishedAt)}</span></div>
        <div class="item"><span class="grow muted">เช็กข้อมูลเมื่อ</span><span>${esc(when(j.finishedAt))}</span></div>
        <div class="item"><span class="grow muted">เครดิตคงเหลือ</span><span>${baht(credit)}</span></div></div>
      <button class="btn" data-act="followup">สั่งต่อจากผลงานนี้</button>
      <button class="btn second" data-act="share">${LINE_MARK}ส่งให้เพื่อนดู</button>
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
  // Same limits as REFUND in src/config.js, for the wording only: the server decides.
  const REFUND_AUTO = 3;
  const REFUND_PRICE_AUTO = 5;
  function refundView() {
    const j = state.job;
    const f = state.refund;
    const price = f.reasons.has(0); // "ราคาไม่ตรงกับหน้าเว็บ" is the first reason: Smith's own mistake
    if (f.result) {
      const [title, text, mascot] = {
        refunded: [`คืนเงินแล้ว ${baht(j.price)}`, price ? "ขอโทษที่ราคาไม่ตรง เป็นความผิดของ Smith เครดิตเข้าแล้ว ใช้สั่งงานต่อได้ทันที เราจะเอาไปปรับ Smith" : "เครดิตเข้าแล้ว ใช้สั่งงานต่อได้ทันที ขอบคุณที่บอก เราจะเอาไปปรับ Smith", "done"],
        review: ["ส่งให้ทีมงานตรวจแล้ว", `เดือนนี้ใช้สิทธิ์คืนเงิน${price ? "กรณีราคาไม่ตรง" : ""}อัตโนมัติครบ ${price ? REFUND_PRICE_AUTO : REFUND_AUTO} ครั้งแล้ว ทีมงานจะตรวจให้ภายใน 1 วันทำการ`, "calm"],
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
      ${price ? `<div class="note good">${I.check}<span>ราคาไม่ตรงเป็นความผิดของ Smith บอกราคาที่คุณเห็นบนหน้าเว็บในช่องด้านล่าง ทีมงานจะได้ตรวจหน้านั้นซ้ำ</span></div>` : ""}
      <div class="col"><label for="note" class="small" style="font-weight:600;padding:0 4px">เล่าเพิ่มอีกนิด (ไม่บังคับ)</label>
        <textarea id="note" class="field" rows="3" maxlength="300" placeholder="เช่น ราคาในหน้าจองสูงกว่าที่สรุปไว้">${esc(f.note)}</textarea></div>
      <div class="note warn">${I.shield}<span>คืนเป็นเครดิตทันที เดือนละ ${REFUND_AUTO} ครั้ง (ราคาไม่ตรงกับหน้าเว็บ ${REFUND_PRICE_AUTO} ครั้ง) เกินนั้นทีมงานตรวจให้ภายใน 1 วันทำการ</span></div>
      <div class="grow"></div>
      <button class="btn" data-act="refund">คืนเงิน ${baht(j.price)}</button>`;
  }

  // ---------- history, credit, settings, help
  // History can be narrowed with a segmented control; the thumb slides, so only the list below it is redrawn.
  const FILTERS = [["ทั้งหมด", () => true], ["สำเร็จ", (j) => ["done", "refund_review"].includes(j.status)], ["ไม่คิดเงิน", (j) => ["failed", "refunded", "cancelled", "rejected"].includes(j.status)]];
  const historyList = () => {
    const jobs = state.jobs.filter(FILTERS[state.filter][1]);
    return jobs.length ? `<div class="card list">${jobs.map(jobRow).join("")}</div>` : '<p class="muted" style="text-align:center;padding:24px 0">ไม่มีงานในหมวดนี้</p>';
  };
  async function history() {
    state.jobs = (await api("GET", "/api/jobs")).data.jobs || [];
    render(`${topbar("งานทั้งหมด")}
      ${state.jobs.length
        ? `<div class="seg" role="group" aria-label="กรองงาน" style="--i:${state.filter}">${FILTERS.map(([label], i) => `<button data-act="filter" data-arg="${i}" aria-pressed="${i === state.filter}">${label}</button>`).join("")}</div>
          <div class="slot" id="hist-list">${historyList()}</div>`
        : `<div class="grow"></div><div class="center"><div class="mascot">${M.small || ""}</div><h1 style="font-size:24px">ยังไม่มีงาน</h1><p class="muted">งานที่สั่งจะอยู่ตรงนี้ทั้งหมด</p></div><div class="grow"></div><a class="btn" href="#/">สั่งงานแรก</a>`}`);
  }

  const KIND = { start: "เครดิตเริ่มต้น", grant: "ทีมงานเติมเครดิต", topup: "เติมเครดิตผ่าน PromptPay", release: "คืนเครดิต งานไม่สำเร็จ", refund: "คืนเงิน" };
  const ledgerRow = (e) => {
    const plus = e.amount > 0;
    const label = e.kind === "hold" ? e.title || "งาน" : e.title ? `${KIND[e.kind]}: ${e.title}` : KIND[e.kind] || e.kind;
    // The icon says what the line is, the way job lists do: the job's kind for a job, a wallet for credit in. Green when money comes in.
    const icon = IC.fill[e.title ? kindOf(e.title) : "wallet"];
    return `<div class="item"><span class="tile bare ${plus ? "good" : ""}">${svg(icon, 28)}</span>
      <span class="grow col" style="gap:2px;min-width:0"><span class="t">${esc(label)}</span><span class="s">${esc(when(e.created_at))}</span></span>
      <span class="money ${plus ? "plus" : ""}">${plus ? "+" : "−"}${baht(Math.abs(e.amount))}</span></div>`;
  };
  async function wallet() {
    const [ledger, me, list] = await Promise.all([api("GET", "/api/ledger"), api("GET", "/api/me"), api("GET", "/api/jobs")]);
    const { credit, entries = [], topups = [] } = ledger.data;
    const pay = me.data.topup; // where to transfer, when the server takes PromptPay top-ups
    // A recent quote not started yet: the way back to it after topping up. Older quotes are left alone.
    const waitingJob = (list.data.jobs || []).find((j) => j.status === "quoted" && Date.now() - Date.parse(j.createdAt) < 7 * 86400e3);
    const latest = topups[0];
    const topupCard = pay
      ? `<div class="card pad col"><div class="row"><span class="tile bare">${svg(IC.fill.wallet, 28)}</span><span class="col grow" style="gap:2px"><span class="t">เติมเครดิต ${baht(pay.amount)}</span>
          <span class="small muted">โอนผ่าน PromptPay แล้วแจ้งทีมงาน</span></span></div>
          <div class="step"><span class="n bare">1</span><span>โอน ${baht(pay.amount)} ไปที่ PromptPay <b>${esc(pay.promptpay)}</b>${pay.name ? ` ชื่อบัญชี ${esc(pay.name)}` : ""} ใส่หมายเหตุการโอนว่า <b>${esc(pay.ref)}</b> ทีมงานใช้รหัสนี้จับคู่ยอดกับบัญชีของคุณ</span></div>
          <button class="link-btn" data-act="copy-pp" style="align-self:flex-start;margin-left:40px;gap:6px">${svg(IC.bold.copy, 18)}คัดลอกเลข PromptPay</button>
          <div class="step"><span class="n bare">2</span><span>กด "โอนแล้ว" ทีมงานตรวจยอดในบัญชีแล้วเติมให้ภายใน 1 วันทำการ</span></div>
          ${latest?.status === "pending"
            ? `<div class="note warn">${I.clock}<span>รอทีมงานตรวจยอด ${baht(latest.amount)} · ${esc(when(latest.created_at))}</span></div>`
            : `${latest?.status === "rejected" ? `<div class="note bad">${I.info}<span>ครั้งก่อนทีมงานยังไม่พบยอดโอน ถ้าโอนแล้วจริง ทักทีมงานพร้อมสลิป</span></div>` : ""}
              <button class="btn" data-act="topup">โอนแล้ว แจ้งทีมงาน</button>`}</div>`
      : `<div class="card pad col"><div class="row"><span class="tile bare">${svg(IC.fill.wallet, 28)}</span><span class="col grow" style="gap:2px"><span class="t">ซื้อเครดิต</span>
          <span class="small muted">ช่วงทดลองยังซื้อในแอปไม่ได้ ทีมงานเติมให้</span></span></div>
          <p class="small muted">ส่งรหัสนี้ให้ทีมงานเพื่อขอเติมเครดิต</p>
          <div class="note" style="font-family:monospace;font-size:12px;user-select:all;overflow-wrap:anywhere">${esc(me.data.id)}</div></div>`;
    state.pay = pay;
    render(`${topbar("เครดิต")}
      <div class="wallet-card"><div class="col grow" style="gap:2px"><div style="font-size:15px;font-weight:500">เครดิตคงเหลือ</div>
        <div class="big">${baht(credit)}</div><div class="small" style="font-weight:600">ใช้ได้ราว ${Math.floor(credit / (me.data.prices?.M || 9))} งาน</div></div><span style="flex:none">${M.small || ""}</span></div>
      ${waitingJob ? `<a class="note" href="#/quote/${waitingJob.id}" style="text-decoration:none;color:inherit">${I.clock}<span class="grow">งานที่รอเริ่ม: ${esc(waitingJob.title || waitingJob.text)} · ${baht(waitingJob.price)}</span><span class="link-btn" style="min-height:0;white-space:nowrap">กลับไปเริ่ม</span></a>` : ""}
      ${topupCard}
      <div class="sect">รายการล่าสุด</div>
      <div class="card list">${entries.map(ledgerRow).join("") || '<div class="item muted">ยังไม่มีรายการ</div>'}</div>`);
  }

  // A sheet slides up over the current screen. What is behind it goes inert until it closes.
  function openSheet(title, body) {
    for (const el of app.children) el.inert = true;
    document.documentElement.style.overflow = "hidden";
    app.insertAdjacentHTML("beforeend", `<div class="scrim" data-act="close-sheet"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><span class="grab" aria-hidden="true"></span><div class="topbar"><span class="gap44"></span><div class="title">${esc(title)}</div>
        <button class="icon-btn" data-act="close-sheet" aria-label="ปิด">${I.x}</button></div>${body}</div>`);
    app.querySelector(".sheet .icon-btn").focus();
  }
  function closeSheet() {
    const parts = app.querySelectorAll(".sheet, .scrim");
    if (!parts.length) return;
    parts.forEach((el) => el.classList.add("out"));
    setTimeout(() => {
      parts.forEach((el) => el.remove());
      for (const el of app.children) el.inert = false;
      document.documentElement.style.overflow = "";
    }, 220);
    window.history.replaceState(null, "", "#/"); // home is already on screen underneath: no reload
  }

  // Settings kept on this phone. Both are on unless switched off.
  // [key, icon, label, default]. Big text is for the 50+ and "not at home on the web" buyers in founder/customer.json.
  const PREFS = [["big", "doc", "ตัวหนังสือใหญ่", false], ["motion", "sparkle", "ภาพเคลื่อนไหว", true], ["pictures", "image", "รูปสินค้าและโลโก้", true]];
  const pref = (key) => (saved.get("prefs") || {})[key] ?? PREFS.find(([k]) => k === key)?.[3] ?? true;
  const THEMES = [["auto", "ตามระบบ"], ["light", "สว่าง"], ["dark", "มืด"]];
  const theme = () => (saved.get("prefs") || {}).theme || "auto";
  const systemDark = matchMedia("(prefers-color-scheme: dark)");
  function applyPrefs() {
    const root = document.documentElement;
    root.classList.toggle("calm", !pref("motion"));
    root.classList.toggle("big", pref("big"));
    root.dataset.theme = theme() === "dark" || (theme() === "auto" && systemDark.matches) ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]').content = root.dataset.theme === "dark" ? "#0B1020" : "#FFFFFF";
  }
  applyPrefs();
  systemDark.addEventListener("change", applyPrefs);

  // Settings open as a sheet over home, so home is shown first when it is not already there.
  async function settings() {
    fresh = false;
    if (!document.getElementById("cmd")) await home();
    else if (state.jobs.some((j) => j.status === "running")) poll(refreshHome, 5000);
    const me = state.me;
    const row = (href, ic, label, right = "", tone = "") =>
      `<a class="item" href="${href}"><span class="tile ${tone}">${D[ic]}</span><span class="grow t">${label}</span>${right}${I.chev}</a>`;
    openSheet("ตั้งค่า", `<div class="list">${row("#/wallet", "wallet", "เครดิต", `<span class="money">${baht(me.credit)}</span>`)}${row("#/history", "list", "งานทั้งหมด")}${row("#/help", "help", "ช่วยเหลือและข้อมูลส่วนตัว")}
        <div class="item" style="flex-direction:column;align-items:stretch;gap:6px;padding:10px 0"><span class="t" id="theme-label">ธีม</span>
          <div class="seg" role="group" aria-labelledby="theme-label" style="--i:${THEMES.findIndex(([k]) => k === theme())}">${THEMES.map(([k, label], i) => `<button data-act="theme" data-arg="${i}" aria-pressed="${k === theme()}">${label}</button>`).join("")}</div></div>
        ${PREFS.map(([key, ic, label], i) => `<div class="item"><span class="tile">${D[ic]}</span><span class="grow t" id="pref-${key}">${label}</span>
          <button class="switch" role="switch" aria-checked="${pref(key)}" aria-labelledby="pref-${key}" data-act="toggle" data-arg="${i}"></button></div>`).join("")}
        ${me.login ? `<button class="item" data-act="logout" style="width:100%;text-align:left"><span class="tile">${D.logout}</span><span class="grow t">ออกจากระบบ</span></button>` : ""}
        ${row("#/delete", "trash", '<span style="color:var(--rtxt)">ลบบัญชีและข้อมูลทั้งหมด</span>', "", "bad")}</div>
      <p class="small muted" style="text-align:center;padding-top:6px">Smith รุ่นทดลอง · รหัส ${esc(me.id.replace(/^web:/, "").slice(0, 8))}</p>`);
  }

  const FAQ = [
    ["Smith คิดเงินยังไง", "บอกราคาก่อนเริ่มทุกงาน หักจากเครดิตไม่เกินราคานั้น ถ้าทำไม่สำเร็จไม่คิดเงิน"],
    ["Smith จ่ายเงินหรือจองแทนฉันได้ไหม", "ไม่ได้ Smith ค้น เทียบ และส่งลิงก์ให้ คุณจ่ายหรือจองเองบนเว็บของร้าน"],
    ["ผลงานไม่ตรง ทำยังไง", "กดขอเงินคืนในหน้าผลงานภายใน 24 ชั่วโมง คืนเป็นเครดิตทันทีเดือนละ 3 ครั้ง ถ้าราคาไม่ตรงกับหน้าเว็บคืนทันทีเดือนละ 5 ครั้ง เกินนั้นทีมงานตรวจให้ภายใน 1 วันทำการ"],
    ["ข้อมูลของฉันไปที่ไหน", "คำสั่งและหน้าเว็บที่ Smith อ่านจะส่งไปประมวลผลกับผู้ให้บริการ AI ในต่างประเทศ Smith ไม่ขายข้อมูลให้ใคร และคุณลบบัญชีพร้อมข้อมูลทั้งหมดได้เองในหน้าตั้งค่า"],
    ["ทำไมต้องรอหลายนาที", "Smith เปิดหลายเว็บเพื่อเทียบและเช็กข้อมูลจริง ปิดแอปไว้ได้ งานยังทำต่อ"],
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
  // Why a quote or a start was turned down, by status.
  const NO = { 429: "สั่งงานบ่อยเกินไป รอสักครู่แล้วลองใหม่", 503: "วันนี้ Smith รับงานเต็มแล้ว ลองใหม่พรุ่งนี้ ไม่คิดเงิน" };
  const actions = {
    async send(_, btn) {
      const text = state.draft.trim();
      if (!text) {
        document.getElementById("cmd")?.focus();
        return toast("พิมพ์งานที่อยากให้ทำก่อน");
      }
      busy(btn, "คิดราคา");
      const r = await api("POST", "/api/quote", { text });
      if (!r.ok) {
        render(homeView());
        return toast(NO[r.status] || "ระบบขัดข้อง ลองใหม่อีกครั้ง");
      }
      state.draft = "";
      saved.set("draft", "");
      go(`#/quote/${r.data.job.id}`);
    },
    compose() {
      const box = document.getElementById("cmd");
      box.scrollIntoView({ block: "center", behavior: pref("motion") ? "smooth" : "auto" });
      box.focus({ preventScroll: true });
    },
    template(i) {
      state.draft = TEMPLATES[i].text;
      saved.set("draft", state.draft);
      render(homeView());
      const box = document.getElementById("cmd");
      fitCmd(box);
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
      if (r.status === 503) return toast(NO[503]), route();
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
      if (!r.ok) return toast(NO[r.status] || "ระบบขัดข้อง ลองใหม่อีกครั้ง"), route();
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
      fresh = true;
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
      await forgetSaved();
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
      await forgetSaved();
      token = newToken(); // a fresh device token: the old one stays unlinked on the server
      saved.set("token", token);
      go("#/login");
    },
    filter(i, btn) {
      state.filter = i;
      btn.parentElement.style.setProperty("--i", i); // the thumb slides to the chosen segment
      for (const b of btn.parentElement.children) b.setAttribute("aria-pressed", String(b === btn));
      document.getElementById("hist-list").innerHTML = historyList();
    },
    toggle(i, btn) {
      const prefs = { ...saved.get("prefs"), [PREFS[i][0]]: !pref(PREFS[i][0]) };
      saved.set("prefs", prefs);
      btn.setAttribute("aria-checked", String(prefs[PREFS[i][0]]));
      applyPrefs();
    },
    theme(i, btn) {
      saved.set("prefs", { ...saved.get("prefs"), theme: THEMES[i][0] });
      btn.parentElement.style.setProperty("--i", i);
      for (const b of btn.parentElement.children) b.setAttribute("aria-pressed", String(b === btn));
      applyPrefs();
    },
    speak(_, btn) {
      const synth = window.speechSynthesis;
      if (synth.speaking) return synth.cancel(); // its "end" event below puts the button back
      const j = state.job;
      const lines = [j.title, j.answer, ...j.options.map((o, i) => `ตัวเลือกที่ ${i + 1} ${o.name} ${o.price} ${o.note}`)];
      const say = new SpeechSynthesisUtterance(lines.join(". ").replace(/฿\s?([\d,.]+)/g, "$1 บาท"));
      say.lang = "th-TH";
      const show = (on) => {
        btn.innerHTML = on ? I.stop : I.speaker;
        btn.setAttribute("aria-label", on ? "หยุดอ่าน" : "ฟังผลงาน");
        btn.setAttribute("aria-pressed", String(on));
      };
      say.onstart = () => show(true);
      say.onend = say.onerror = () => show(false);
      synth.speak(say);
    },
    async share() {
      if (!state.job) return;
      const text = shareText(state.job);
      if (navigator.share) {
        try {
          return await navigator.share({ text }); // the phone's own share sheet, LINE included
        } catch (err) {
          if (err.name === "AbortError") return; // closed the sheet
        }
      }
      window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    },
    async topup(_, btn) {
      busy(btn, "กำลังแจ้ง");
      const r = await api("POST", "/api/topup");
      await route();
      toast(r.ok ? "แจ้งแล้ว ทีมงานจะตรวจยอดแล้วเติมให้ภายใน 1 วันทำการ" : "แจ้งไม่สำเร็จ ลองใหม่อีกครั้ง");
    },
    async "copy-pp"() {
      const n = state.pay?.promptpay;
      if (!n) return;
      try {
        await navigator.clipboard.writeText(n);
        toast(`คัดลอก ${n} แล้ว`);
      } catch {
        toast(`เลข PromptPay คือ ${n}`); // clipboard needs https; the number is on screen to select
      }
    },
    async copy(i) {
      const code = state.job?.codes?.[i]?.code;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        toast(`คัดลอกโค้ด ${code} แล้ว`);
      } catch {
        toast(`โค้ดคือ ${code} กดค้างที่โค้ดเพื่อคัดลอก`); // clipboard needs https; on plain http the code is still on screen to select
      }
    },
    "close-sheet": closeSheet,
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
      if (err instanceof RoundFull) return go("#/full");
      toast(err.message === "offline" ? "เชื่อมต่อไม่ได้ เช็กอินเทอร์เน็ตแล้วลองใหม่" : "ระบบขัดข้อง ลองใหม่อีกครั้ง");
      route();
    }
  });
  // A site without a saved logo, or a picture that is gone: drop the broken image (the globe under a logo then shows).
  app.addEventListener("error", (e) => e.target.matches?.(".logo, .shot, .mini-logo") && e.target.remove(), true);
  // Drag the sheet down to close it. Only from the top of its scroll, so scrolling its content still works.
  let drag = null;
  app.addEventListener("touchstart", (e) => {
    const sheet = e.target.closest?.(".sheet");
    drag = sheet && sheet.scrollTop <= 0 ? { sheet, y: e.touches[0].clientY, dy: 0, at: e.timeStamp } : null;
  }, { passive: true });
  app.addEventListener("touchmove", (e) => {
    if (!drag) return;
    drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
    if (drag.dy < 6) return; // a tap that wobbles is still a tap
    // The slide-up animation would win over this transform, so it is switched off for good; a transition takes over.
    Object.assign(drag.sheet.style, { animation: "none", transition: "none", transform: `translateY(${drag.dy}px)` });
  }, { passive: true });
  app.addEventListener("touchend", (e) => {
    if (!drag) return;
    const { sheet, dy, at } = drag;
    drag = null;
    if (dy < 6) return;
    const close = dy > 90 || (dy > 24 && dy / (e.timeStamp - at) > 0.5); // far enough, or a quick flick (over 0.5px per ms)
    Object.assign(sheet.style, { transition: `transform ${close ? "220ms ease-in" : "320ms var(--spring)"}`, transform: close ? "translateY(100%)" : "translateY(0)" });
    if (close) closeSheet();
  });

  // Onboarding slides also turn with a swipe.
  let swipeX = null;
  app.addEventListener("touchstart", (e) => (swipeX = location.hash === "#/welcome" ? e.touches[0].clientX : null), { passive: true });
  app.addEventListener("touchend", (e) => {
    const dx = swipeX === null ? 0 : e.changedTouches[0].clientX - swipeX;
    swipeX = null;
    if (dx < -48) actions.next();
    if (dx > 48 && state.slide > 0) {
      state.slide -= 1;
      fresh = true;
      welcome();
    }
  });
  app.addEventListener("input", (e) => {
    if (e.target.id === "cmd") {
      fitCmd(e.target);
      state.draft = e.target.value;
      saved.set("draft", state.draft);
    }
    if (e.target.id === "note") state.refund.note = e.target.value;
    if (e.target.id === "confirm") app.querySelector('[data-act="delete"]').disabled = e.target.value.trim() !== "ลบบัญชี";
  });

  // ---------- routing
  let renders = 0;
  let fresh = false; // the next render is a new screen, so it animates in; redraws of the same screen do not
  let settle;
  function render(html) {
    renders++;
    clearTimeout(settle);
    document.documentElement.style.overflow = ""; // a sheet may have locked scrolling
    app.classList.toggle("in", fresh);
    if (fresh) settle = setTimeout(() => app.classList.remove("in"), 1200); // later partial redraws (polls) must not replay it
    fresh = false;
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
    [/^#\/full$/, roundFull],
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
    gen++;
    window.speechSynthesis?.cancel(); // leaving a screen stops it being read aloud
    clearTimeout(poller);
    const hash = location.hash;
    if (!saved.get("consent") && !/^#\/(welcome|consent|help|invite|privacy|terms|login|full)/.test(hash)) return go("#/welcome");
    const hit = ROUTES.find(([re]) => re.test(hash));
    if (!hit) return go("#/");
    const arg = hit[0].exec(hash)[1];
    const before = renders;
    const slow = setTimeout(() => {
      if (renders !== before) return;
      fresh = false; // the skeleton just appears; the real screen is what animates in
      render(skeleton(hash));
      fresh = true;
    }, 150);
    fresh = true;
    try {
      await hit[1](arg && /^\d+$/.test(arg) ? Number(arg) : undefined);
      window.scrollTo(0, 0);
    } catch (err) {
      if (err instanceof Stale) return;
      if (err instanceof InviteNeeded) return go("#/invite");
      if (err instanceof LoginNeeded) return go("#/login");
      if (err instanceof RoundFull) return go("#/full");
      render(errorView(err));
    } finally {
      clearTimeout(slow);
    }
  }
  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }
  window.addEventListener("keydown", (e) => e.key === "Escape" && closeSheet());
  window.addEventListener("hashchange", route);
  window.addEventListener("online", () => document.getElementById("offline-bar") && route()); // the connection is back: replace what was saved
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {})); // the app works without it
  window.addEventListener("pageshow", (e) => e.persisted && route()); // back from LINE Login: drop the busy button
  route();
})();
