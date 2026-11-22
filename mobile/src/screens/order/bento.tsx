// The home grid (homeParts() in public/app.js, .bento/.tile-card in app.css): the job running now or the price list,
// the big "new job" card, the latest result, the latest jobs, and this month's spend. Each card rises in, in turn.
import { useEffect, useState, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { router, type Href } from "expo-router";
import { Enter, Icon, Press, T, lift, useColors, toneOf, type Colors } from "@/ui/kit";
import { Mascot } from "@/ui/Mascot";
import { baht, duration, kindOf, STATUS, thisMonth } from "@/lib/format";
import type { Job, Me } from "@/lib/api";
import { CountUp, useMotion } from "./shared";

const go = (href: string) => router.push(href as Href);

function TileCard({ kind, onPress, label, wide, style, children }: { kind: "soft" | "blue" | "line"; onPress?: () => void; label?: string; wide?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const c = useColors();
  const box: StyleProp<ViewStyle> = [
    { minHeight: wide ? 0 : 176, borderRadius: 24, padding: 16, gap: 6, flex: 1 },
    kind === "soft" && { backgroundColor: c.soft },
    kind === "blue" && { backgroundColor: c.blue },
    kind === "line" && [{ backgroundColor: c.surf }, lift(c)],
    wide && { flexDirection: "row", alignItems: "center", gap: 16 },
    style,
  ];
  return onPress ? <Press onPress={onPress} label={label} role="link" scale={0.97} style={box}>{children}</Press> : <View style={box}>{children}</View>;
}
const H = ({ children, color }: { children: ReactNode; color?: string }) => <T font="mitr-600" size={17} lh={1.3} color={color}>{children}</T>;
function S({ children, color, lines, link }: { children: ReactNode; color?: string; lines?: number; link?: boolean }) {
  const c = useColors();
  return <T size={13} lh={1.4} font={link ? "prompt-500" : "prompt"} color={color ?? (link ? c.link : c.mut)} numberOfLines={lines}>{children}</T>;
}
function KV({ k, v, color, vColor }: { k: string; v: string; color?: string; vColor?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <T size={13} color={color} style={{ flexShrink: 1 }}>{k}</T>
      <T size={13} font="prompt-600" color={vColor ?? color} numberOfLines={1}>{v}</T>
    </View>
  );
}
const Spacer = () => <View style={{ flexGrow: 1 }} />;

// The progress bar's blue piece sweeps across, as .bar i { animation: sweep-bar }.
function SweepBar() {
  const c = useColors();
  const motion = useMotion();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (motion && w) x.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1);
  }, [motion, w, x]);
  const s = useAnimatedStyle(() => ({ transform: [{ translateX: -w * 0.4 + x.value * w * 1.4 }] }));
  return (
    <View accessible={false} onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: 8, borderRadius: 4, backgroundColor: c.line, overflow: "hidden" }}>
      <Animated.View style={[{ width: "40%", height: "100%", borderRadius: 4, backgroundColor: c.blue }, motion && s]} />
    </View>
  );
}

const kindColor = (c: Colors, status: string) => {
  const t = (STATUS[status] || ["", "grey"])[1];
  return t ? toneOf(c, t)[1] : c.link;
};

export function Bento({ me, jobs, onCompose }: { me: Me; jobs: Job[]; onCompose: () => void }) {
  const c = useColors();
  const running = jobs.find((j) => j.status === "running");
  const done = jobs.find((j) => ["done", "refund_review", "refunded"].includes(j.status));
  const recent = jobs.filter((j) => !["rejected", "cancelled"].includes(j.status) && j !== running && j !== done).slice(0, 3);
  const month = jobs.filter((j) => thisMonth(j.createdAt));
  const spent = month.filter((j) => ["done", "refund_review"].includes(j.status)).reduce((s, j) => s + j.price, 0);
  const ok = month.filter((j) => ["done", "refund_review", "refunded"].includes(j.status)).length;
  const failed = month.filter((j) => j.status === "failed").length;
  const prices: Partial<Me["prices"]> = me.prices || {};

  const now = running ? (
    <TileCard kind="soft" onPress={() => go(`/job/${running.id}`)} label={`กำลังทำ ${running.title || running.text}`}>
      <H>กำลังทำ</H>
      <S lines={2}>{running.title || running.text}</S>
      <Spacer />
      <T font="mitr-700" size={40} lh={1} style={{ letterSpacing: -1 }}>
        {(running.progress || []).filter((x) => x.host).length}
        <T font="mitr-600" size={16} style={{ letterSpacing: 0 }}> เว็บที่อ่าน</T>
      </T>
      <SweepBar />
      <View accessibilityLiveRegion="polite"><S link lines={2}>{running.progress?.at(-1)?.text || "กำลังเริ่มงาน"}</S></View>
    </TileCard>
  ) : (
    <TileCard kind="soft" onPress={() => go("/help")} label="ราคาต่องาน">
      <H>ราคาต่องาน</H>
      <S>บอกก่อนเริ่มทุกงาน ไม่สำเร็จไม่คิดเงิน</S>
      <Spacer />
      <T font="mitr-700" size={40} lh={1} style={{ letterSpacing: -1 }}>{baht(prices.M || 9)}</T>
      <S>งานกลาง · เล็ก {baht(prices.S || 5)} · ใหญ่ {baht(prices.L || 15)}</S>
    </TileCard>
  );

  const start = (
    <Press onPress={onCompose} label="สั่งงานใหม่เลย!" scale={0.96} style={{ flex: 1, minHeight: 176, borderRadius: 24, overflow: "hidden", backgroundColor: c.yel }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 8 }}><Mascot pose="small" /></View>
      <View style={{ backgroundColor: c.cor, paddingTop: 12, paddingHorizontal: 16, paddingBottom: 14, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
        <T font="mitr-700" size={24} lh={1.1} color="#0B1B4D">{"สั่งงาน\nใหม่เลย!"}</T>
      </View>
    </Press>
  );

  const white = "#FFFFFF";
  const last = done ? (
    <TileCard kind="blue">
      <H color={white}>เสร็จแล้ว</H>
      <S color="#DCE6FF" lines={2}>{done.title || done.text}</S>
      <Spacer />
      <KV k="อ่านเว็บ" v={`${done.coverage?.hosts?.length || done.sources?.length || 0} เว็บ`} color={white} />
      <KV k="ใช้เวลา" v={duration(done.startedAt, done.finishedAt ?? undefined)} color={white} />
      <Press onPress={() => go(`/job/${done.id}`)} role="link" label="ดูผลงาน" style={{ marginTop: 4, height: 44, borderRadius: 22, backgroundColor: white, alignItems: "center", justifyContent: "center" }}>
        <T font="prompt-600" size={14} color="#0A4BFF">ดูผลงาน</T>
      </Press>
    </TileCard>
  ) : (
    <TileCard kind="blue">
      <H color={white}>ผลงาน</H>
      <S color="#DCE6FF">งานที่เสร็จจะอยู่ตรงนี้ พร้อมลิงก์ให้เปิดตรวจเอง</S>
      <Spacer />
      <KV k="ไม่สำเร็จ" v="ไม่คิดเงิน" color={white} />
      <KV k="ผลไม่ตรง" v="ขอคืนได้" color={white} />
    </TileCard>
  );

  const list = (
    <TileCard kind="line">
      <H>งานล่าสุด</H>
      {recent.length ? recent.map((j) => (
        <Press key={j.id} onPress={() => go(["quoted", "rejected"].includes(j.status) ? `/quote/${j.id}` : `/job/${j.id}`)} role="link" label={j.title || j.text} scale={0.97} haptic={false}
          style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 }}>
          <Icon name={kindOf(`${j.title} ${j.text}`)} fill size={22} color={kindColor(c, j.status)} />
          <T size={13} numberOfLines={1} style={{ flex: 1 }}>{j.title || j.text}</T>
        </Press>
      )) : <S>ยังไม่มีงานอื่น ลองแตะตัวอย่างด้านล่าง</S>}
      <Spacer />
      <Press onPress={() => go("/history")} role="link" label="ดูทั้งหมด" scale={0.97} haptic={false}><S link>ดูทั้งหมด</S></Press>
    </TileCard>
  );

  const spend = (
    <TileCard kind="line" wide onPress={() => go("/history")} label={`ใช้ไปเดือนนี้ ${baht(spent)}`}>
      <View>
        <H>ใช้ไปเดือนนี้</H>
        <CountUp value={spent} size={40} lh={1} />
      </View>
      <View style={{ flexGrow: 1, flexShrink: 1, gap: 6 }}>
        <KV k="งานสำเร็จ" v={`${ok} งาน`} />
        <KV k={`ไม่สำเร็จ ${failed} งาน`} v="ไม่คิดเงิน" vColor={c.gtxt} />
      </View>
    </TileCard>
  );

  const pair = (a: ReactNode, b: ReactNode, i: number) => (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "stretch" }}>
      <Enter delay={i * 70} style={{ flex: 1 }}>{a}</Enter>
      <Enter delay={i * 70 + 50} style={{ flex: 1 }}>{b}</Enter>
    </View>
  );
  return (
    <View style={{ gap: 12 }}>
      {pair(now, start, 0)}
      {pair(last, list, 2)}
      <Enter delay={280}>{spend}</Enter>
    </View>
  );
}
