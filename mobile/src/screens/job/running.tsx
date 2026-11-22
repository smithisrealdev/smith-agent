// A running job (runningView, elapsed, liveSteps in public/app.js): the agent's last steps rise in as they arrive.
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { router, type Href } from "expo-router";
import { Mascot } from "@/ui/Mascot";
import { Btn, Center, Dots, Grow, H1, Icon, Logo, Money, Muted, Note, Pill, Press, Row, Screen, T, TopBar, useColors } from "@/ui/kit";
import type { Job } from "@/lib/api";
import { baht, duration } from "@/lib/format";
import { goHome, useMotion } from "./parts";

// "ผ่านไป …" ticks every second, between polls too.
function Elapsed({ j }: { j: Job }) {
  const [now, setNow] = useState(() => new Date().toISOString()); // the time is state, so the React Compiler re-renders on each tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(t);
  }, []);
  return <Pill icon="clock">{`ผ่านไป ${duration(j.startedAt, now)} · ประมาณ ${j.minutes} นาที`}</Pill>;
}

function Num({ kind, children }: { kind?: "ok" | "now"; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: kind === "now" ? c.blue : c.surf, alignItems: "center", justifyContent: "center" }}>{children}</View>
  );
}

function Steps({ j }: { j: Job }) {
  const c = useColors();
  const motion = useMotion();
  const progress = j.progress || [];
  if (!progress.length) {
    return j.steps.map((s, i) => (
      <Row key={`p${i}`} gap={12} style={{ alignItems: "flex-start" }}>
        <Num><T font="mitr-600" size={14}>{i + 1}</T></Num>
        <T size={14} style={{ flex: 1, paddingTop: 3 }}>{s}</T>
      </Row>
    ));
  }
  const from = Math.max(0, progress.length - 5);
  return progress.slice(from).map((p, k) => {
    const i = from + k;
    const now = i === progress.length - 1;
    return (
      <Animated.View key={i} entering={motion ? FadeInDown.duration(260) : undefined} exiting={motion ? FadeOut.duration(160) : undefined} layout={motion ? LinearTransition.springify().damping(18) : undefined}
        style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <Num kind={now ? "now" : "ok"}>
          <Icon name={now ? "bolt" : "check"} size={16} color={now ? "#FFFFFF" : c.gtxt} />
          {p.host ? <Logo uri={`/logo/${p.host}.png`} style={{ borderRadius: 14, padding: 5 }} /> : null}
        </Num>
        <View style={{ flex: 1, paddingTop: 3, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <T size={14}>{p.text}</T>
          {now && <Dots />}
        </View>
      </Animated.View>
    );
  });
}

export function RunningView({ j }: { j: Job }) {
  const c = useColors();
  const last = j.progress?.at(-1)?.text || "";
  return (
    <Screen>
      <TopBar title={j.title} />
      <Center style={{ paddingTop: 4 }}>
        <View style={{ paddingTop: 24 }}><Mascot pose="work" /></View>{/* room for the thinking dots above the cat */}
        <Row gap={8} style={{ justifyContent: "center" }}>
          <H1 accessibilityLiveRegion="polite">กำลังทำงาน</H1>
          <Dots />
        </Row>
        <Elapsed j={j} />
      </Center>
      <View accessibilityLiveRegion="polite" accessibilityLabel={last || undefined} style={{ borderRadius: 24, backgroundColor: c.soft, padding: 16, gap: 12 }}>
        <Steps j={j} />
      </View>
      <Press onPress={() => router.push(`/live/${j.id}` as Href)} scale={0.97} role="link" label="ดู Smith ทำงานสด"
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 24, backgroundColor: c.inkbg }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.blue, alignItems: "center", justifyContent: "center" }}><Icon name="image" fill size={22} color="#FFFFFF" /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <T font="mitr-600" size={16} color="#FFFFFF">ดู Smith ทำงานสด</T>
          <T size={13} color="#C9D4F2">เห็นหน้าเว็บที่ Smith กำลังเปิดอ่าน</T>
        </View>
        <Icon name="chev" color="#FFFFFF" />
      </Press>
      <Note>ปิดแอปได้เลย งานยังทำต่อ กลับมาดูผลได้ที่หน้าแรก</Note>
      <Grow />
      <Row style={{ justifyContent: "space-between", paddingHorizontal: 4 }}>
        <Muted>ราคาที่ตกลงไว้</Muted>
        <Money>{baht(j.price)}</Money>
      </Row>
      <Btn title="กลับหน้าแรก" kind="second" onPress={goHome} />
    </Screen>
  );
}
