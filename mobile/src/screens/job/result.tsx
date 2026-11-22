// A finished job (doneView, failedView, cancelledView in public/app.js) and the chat under its result.
import { useRef, useState } from "react";
import { Platform, View } from "react-native";
import Animated, { FadeInDown, LinearTransition, ZoomIn } from "react-native-reanimated";
import { Image } from "expo-image";
import { SvgXml } from "react-native-svg";
import { ICONS } from "@/ui/icon-data";
import { router, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Mascot } from "@/ui/Mascot";
import { Bubble, Btn, Card, Center, ChatBox, Grow, H1, Icon, List, Item, Logo, Money, Muted, Note, Pill, Press, Row, Screen, Sect, T, Tile, TopBar, useColors } from "@/ui/kit";
import { full, type ChatEntry, type Job, type Option } from "@/lib/api";
import { answerRuns, baht, brandOf, duration, hostOf, isWeb, plain, when } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { Burst, Sparks, openWeb, pictureOf, useMotion } from "./parts";

export type Acts = {
  busy: string | null; // which button is working: "retry" | "start:<id>"
  retry: () => void;
  edit: () => void;
  share: () => void;
  copy: (code: string) => void;
  ask: (text: string) => Promise<boolean>;
  start: (id: number) => void;
};

const Lefty = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: "row" }}>{children}</View>; // a pill at the start of its card

function AnswerCard({ j }: { j: Job }) {
  const c = useColors();
  return (
    <Card style={{ gap: 10 }}>
      <Lefty><Pill icon="sparkle">{j.options?.length ? "Smith แนะนำ" : "สรุปจาก Smith"}</Pill></Lefty>
      {answerRuns(j.answer).map((r, i) => r.kind === "p"
        ? <T key={i} selectable font={r.lead ? "mitr" : "prompt"} size={r.lead ? 17 : 16} lh={r.lead ? 1.5 : 1.6}>{r.lines.join("\n")}</T>
        : (
          <View key={i} style={{ gap: 8 }}>
            {r.lines.map((l, k) => (
              <Row key={k} gap={8} style={{ alignItems: "flex-start" }}>
                {r.kind === "ul" ? <View style={{ marginTop: 5 }}><Icon name="check" size={16} color={c.gtxt} /></View> : <T font="prompt-600" size={16} lh={1.6} color={c.gtxt} style={{ minWidth: 22 }}>{`${k + 1}.`}</T>}
                <T selectable size={16} lh={1.6} style={{ flex: 1 }}>{l}</T>
              </Row>
            ))}
          </View>
        ))}
    </Card>
  );
}

function OptionCard({ o, i }: { o: Option; i: number }) {
  const c = useColors();
  const { prefs } = usePrefs();
  const [shotGone, setShotGone] = useState(false);
  const url = isWeb(o.url) ? (o.url as string) : "";
  const brand = brandOf(o);
  const shot = prefs.pictures && !shotGone ? pictureOf(o) : "";
  const body = (
    <Card style={[{ gap: 6 }, !i && { borderWidth: 2, borderColor: c.blue }]}>
      {!i && <Lefty><Pill tone="good" icon="check">แนะนำ</Pill></Lefty>}
      <Row style={{ alignItems: "flex-start" }}>
        {shot ? (
          <View>
            <Image source={{ uri: full(shot) }} onError={() => setShotGone(true)} contentFit="cover" transition={200}
              style={{ width: 72, height: 72, borderRadius: 14, backgroundColor: c.field, borderWidth: 1, borderColor: c.line }} />
            {brand ? <Logo uri={`/logo/${brand}.png`} style={{ top: undefined, left: undefined, right: -5, bottom: -5, width: 28, height: 28, padding: 3, borderRadius: 9 }} /> : null}
          </View>
        ) : <Tile icon={brand ? "link" : "tag"} tone={brand ? undefined : "grey"} logo={brand || undefined} />}
        <View style={{ flex: 1, gap: 4 }}>
          <T font="mitr" size={16} lh={1.4}>{o.name}</T>
          {o.price ? <T font="mitr-700" size={20} lh={1.3}>{o.price}</T> : null}
          {o.note ? <Muted small>{o.note}</Muted> : null}
          {url ? <Row gap={6}><T font="prompt-600" size={13} color={c.link} style={{ flexShrink: 1 }}>{hostOf(url)}</T><Icon name="external" size={14} color={c.link} /></Row> : null}
        </View>
      </Row>
    </Card>
  );
  return url ? <Press onPress={() => openWeb(url)} scale={0.97} role="link" label={`${o.name} ${o.price || ""}`}>{body}</Press> : body;
}

function CodeRow({ k, copy }: { k: Job["codes"][number]; copy: (code: string) => void }) {
  const c = useColors();
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, gap: 3 }}>
        <T selectable size={20} style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontWeight: "700", letterSpacing: 0.5 }}>{k.code}</T>
        {k.shop || k.note ? <Muted small>{[k.shop, k.note].filter(Boolean).join(" · ")}</Muted> : null}
        {isWeb(k.url) ? (
          <Press onPress={() => openWeb(k.url)} scale={0.97} role="link" haptic={false} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <T font="prompt-600" size={13} color={c.link}>{`เจอที่ ${hostOf(k.url)}`}</T><Icon name="external" size={14} color={c.link} />
          </Press>
        ) : null}
      </View>
      <Press onPress={() => copy(k.code)} label={`คัดลอก ${k.code}`} style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: c.soft }}>
        <Icon name="copy" size={16} color={c.link} /><T font="mitr-600" size={15} color={c.link}>คัดลอก</T>
      </Press>
    </Card>
  );
}

function CoverageCard({ cov }: { cov: Job["coverage"] }) {
  const c = useColors();
  const { prefs } = usePrefs();
  if (!cov || (!cov.searches && !cov.pages)) return null;
  const hosts = cov.hosts || [];
  return (
    <Card>
      <T font="mitr-600" size={16}>Smith อ่านอะไรบ้าง</T>
      <Muted small>{`ค้น ${Number(cov.searches) || 0} ครั้ง · อ่าน ${Number(cov.pages) || 0} หน้า จาก ${hosts.length} เว็บ`}</Muted>
      {hosts.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {hosts.map((h) => (
            <View key={h} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28, paddingLeft: 6, paddingRight: 10, borderRadius: 14, backgroundColor: c.field }}>
              {prefs.pictures ? <MiniLogo host={h} /> : null}
              <T font="prompt-500" size={12}>{h}</T>
            </View>
          ))}
        </View>
      ) : null}
      {cov.blocked?.length ? <Note tone="warn">{`อ่านไม่ได้: ${cov.blocked.join(", ")} ราคาจากเว็บนี้อาจไม่อยู่ในผล`}</Note> : null}
    </Card>
  );
}
function MiniLogo({ host }: { host: string }) {
  const [gone, setGone] = useState(false);
  return gone ? null : <Image source={{ uri: full(`/logo/${host}.png`) }} onError={() => setGone(true)} contentFit="contain" style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: "#FFFFFF" }} />;
}

function SourceRow({ s }: { s: Job["sources"][number] }) {
  const c = useColors();
  const host = hostOf(s.url);
  return (
    <Press onPress={() => openWeb(s.url)} scale={0.98} haptic={false} role="link" label={s.title || host} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 8 }}>
      <Tile icon="link" logo={host || undefined} />
      <View style={{ flex: 1, gap: 2 }}>
        <T font="mitr" size={14} numberOfLines={2}>{s.title || host}</T>
        <T size={12} color={c.mut}>{host}</T>
      </View>
      <Icon name="external" color={c.mut} />
    </Press>
  );
}

// The evidence screenshot, full width at its own shape; a tap opens it whole.
function Evidence({ path }: { path: string }) {
  const c = useColors();
  const [ratio, setRatio] = useState(0.6);
  return (
    <Press onPress={() => WebBrowser.openBrowserAsync(full(path)).catch(() => {})} scale={0.98} label="ภาพหน้าจอเว็บที่ Smith ใช้เป็นหลักฐาน แตะเพื่อดูภาพเต็ม">
      <Image source={{ uri: full(path) }} contentFit="cover" transition={200} onLoad={(e) => e.source.width && setRatio(e.source.width / e.source.height)}
        style={{ width: "100%", aspectRatio: ratio, borderRadius: 16, borderWidth: 1, borderColor: c.line, backgroundColor: c.field }} />
    </Press>
  );
}

// ---------- the chat under a result
const freeLeft = (j: Job) => !j.parentId;
function ChildCard({ ch, acts }: { ch: NonNullable<ChatEntry["child"]>; acts: Acts }) {
  const open = (label: string) => <Btn title={label} kind="second" onPress={() => router.push(`/job/${ch.id}` as Href)} />;
  const next = ch.status === "quoted"
    ? <Btn title={ch.price ? `เริ่มงาน ${baht(ch.price)}` : "ค้นใหม่ฟรี"} busy={acts.busy === `start:${ch.id}` && "กำลังเริ่ม"} onPress={() => acts.start(ch.id)} />
    : ch.status === "running" ? open("กำลังค้น ดูความคืบหน้า")
    : ["done", "refunded", "refund_review"].includes(ch.status) ? open("ดูผลค้นใหม่")
    : ch.status === "failed" ? open("ค้นใหม่ไม่สำเร็จ ไม่คิดเงิน")
    : <Muted small>ยกเลิกแล้ว</Muted>;
  return (
    <View style={{ gap: 8 }}>
      <T font="mitr-600">{ch.title}</T>
      {ch.steps.length ? <View style={{ gap: 2 }}>{ch.steps.map((s, i) => <T key={i} size={14} lh={1.5}>{`${i + 1}. ${s}`}</T>)}</View> : null}
      {next}
    </View>
  );
}

function ChatPart({ j, acts }: { j: Job; acts: Acts }) {
  const motion = useMotion();
  const seen = useRef(j.chat.length); // bubbles there when the screen opened stay put; new ones rise in
  return (
    <>
      <Sect>คุยกับ Smith</Sect>
      {j.chat.length ? (
        <View style={{ gap: 8 }}>
          {j.chat.map((e, i) => (
            <Animated.View key={i} entering={motion && i >= seen.current ? FadeInDown.duration(260).delay(e.role === "smith" ? 120 : 0) : undefined} layout={motion ? LinearTransition : undefined}
              accessibilityLiveRegion={i === j.chat.length - 1 ? "polite" : undefined}>
              {e.role === "user" ? <Bubble text={e.text} /> : <Bubble smith text={plain(e.text)}>{e.child ? <ChildCard ch={e.child} acts={acts} /> : null}</Bubble>}
            </Animated.View>
          ))}
        </View>
      ) : (
        <Muted small style={{ paddingHorizontal: 4, marginTop: -6 }}>
          {freeLeft(j) ? "ถามเรื่องผลนี้ได้ฟรี หรือบอกว่าไม่ถูกใจตรงไหน Smith ค้นใหม่ให้ฟรี 1 ครั้ง" : "ถามเรื่องผลนี้ได้ฟรี หรืออยากให้ค้นใหม่ก็บอกได้ Smith บอกราคาก่อนเริ่ม"}
        </Muted>
      )}
      <ChatBox placeholder="ถามเพิ่ม หรือบอกว่าอยากให้ค้นใหม่แบบไหน" empty="พิมพ์คำถามก่อน" onSend={acts.ask} />
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <Item><Muted style={{ flex: 1 }}>{label}</Muted>{children}</Item>;
}

export function DoneView({ j, credit, fresh, acts }: { j: Job; credit: number; fresh: boolean; acts: Acts }) {
  const motion = useMotion();
  const refundable = j.price > 0 && j.status === "done" && Date.now() - Date.parse(String(j.finishedAt)) < 24 * 3600e3; // a free re-search has nothing to refund
  const sources = j.sources.filter((s) => isWeb(s.url));
  return (
    <Screen>
      <TopBar title={j.title} />
      <Animated.View entering={fresh && motion ? ZoomIn.springify().damping(11) : undefined}>
        <Center>
          <View style={{ alignSelf: "stretch", alignItems: "center" }}>
            <View style={{ paddingTop: 20 }}><Mascot pose="done" /></View>{/* room for the rising hearts */}
            <Sparks />
            {fresh && <Burst />}
          </View>
          <H1 accessibilityLiveRegion="polite">เสร็จแล้ว!</H1>
        </Center>
      </Animated.View>
      {j.status === "refunded" && <Note tone="good" icon="check">{`คืนเงิน ${baht(j.price)} เป็นเครดิตแล้ว`}</Note>}
      {j.status === "refund_review" && <Note tone="warn" icon="clock">ทีมงานกำลังตรวจคำขอคืนเงิน ภายใน 1 วันทำการ</Note>}
      <AnswerCard j={j} />
      {j.options?.length ? <><Sect>ตัวเลือกที่เจอ</Sect>{j.options.map((o, i) => <OptionCard key={i} o={o} i={i} />)}</> : null}
      {j.codes?.length ? (
        <>
          <Sect>โค้ดส่วนลดที่เจอ</Sect>
          <Muted small style={{ paddingHorizontal: 4, marginTop: -6 }}>เจอบนหน้าเว็บ อาจหมดอายุ ตรวจก่อนใช้</Muted>
          {j.codes.map((k, i) => <CodeRow key={i} k={k} copy={acts.copy} />)}
        </>
      ) : null}
      <Sect>หลักฐานที่ตรวจเองได้</Sect>
      {/^\/evidence\/[\w-]+\.png$/.test(j.evidence || "") ? <Evidence path={j.evidence} /> : null}
      {sources.length ? <List>{sources.map((s, i) => <SourceRow key={i} s={s} />)}</List> : <Muted small style={{ paddingHorizontal: 4 }}>งานนี้ไม่มีลิงก์อ้างอิง</Muted>}
      <CoverageCard cov={j.coverage} />
      <List>
        <Detail label="จ่ายจริง"><Money>{j.status === "refunded" ? baht(0) : baht(j.price)}</Money></Detail>
        <Detail label="ใช้เวลา"><T>{duration(j.startedAt, j.finishedAt || undefined)}</T></Detail>
        <Detail label="เช็กข้อมูลเมื่อ"><T>{when(j.finishedAt)}</T></Detail>
        <Detail label="เครดิตคงเหลือ"><T>{baht(credit)}</T></Detail>
      </List>
      <ChatPart j={j} acts={acts} />
      <Btn title="ส่งให้เพื่อนดู" kind="second" icon={<LineIcon />} onPress={acts.share} />
      <Btn title="ทำงานนี้อีกครั้ง" kind="second" busy={acts.busy === "retry" && "กำลังคิดราคา"} onPress={acts.retry} />
      {refundable && <Btn title="ผลไม่ตรง ขอเงินคืน" kind="text-danger" onPress={() => router.push(`/refund/${j.id}` as Href)} />}
    </Screen>
  );
}
// LINE_MARK in the button's own colour, as on the web app's .btn.second.
function LineIcon() {
  const c = useColors();
  return <SvgXml xml={`<svg viewBox="0 0 24 24" fill="currentColor">${ICONS.line}</svg>`} width={24} height={24} color={c.link} />;
}

export function FailedView({ j, credit, acts }: { j: Job; credit: number; acts: Acts }) {
  return (
    <Screen>
      <TopBar title={j.title} />
      <Center>
        <Mascot pose="calm" />
        <H1 size={26} accessibilityLiveRegion="polite">งานนี้ยังไม่สำเร็จ</H1>
        <Row gap={8} style={{ justifyContent: "center", flexWrap: "wrap" }}>
          <Pill tone="good" icon="check">ไม่คิดเงิน ฿0</Pill>
          <Pill tone="grey">{`เครดิตเท่าเดิม ${baht(credit)}`}</Pill>
        </Row>
      </Center>
      <Card>
        <T font="mitr-600">เกิดอะไรขึ้น</T>
        <Muted selectable style={{ lineHeight: 15 * 1.55 }}>{j.answer}</Muted>
      </Card>
      <Grow />
      <Btn title="ลองใหม่อีกครั้ง" busy={acts.busy === "retry" && "กำลังคิดราคา"} onPress={acts.retry} />
      <Btn title="แก้คำสั่ง" kind="second" onPress={acts.edit} />
    </Screen>
  );
}

// Cancelled before it started, or stopped by "ให้ฉันทำต่อเอง" (then it has a start time, and the page Smith was on).
export function CancelledView({ j }: { j: Job }) {
  const page = isWeb(j.sources[0]?.url) ? j.sources[0].url : "";
  return (
    <Screen>
      <TopBar title={j.title} />
      <Center>
        <Mascot pose="calm" />
        <H1 size={24}>{j.startedAt ? "Smith หยุดแล้ว ทำต่อได้เลย" : "ยกเลิกงานนี้แล้ว"}</H1>
        <Muted>ไม่คิดเงิน</Muted>
      </Center>
      {page ? <><Grow /><Btn title="เปิดหน้าที่ Smith เปิดค้างไว้" iconRight={<Icon name="external" color="#FFFFFF" />} onPress={() => openWeb(page)} /></> : null}
    </Screen>
  );
}

