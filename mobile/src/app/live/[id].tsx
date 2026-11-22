// Watching a running job (liveScreen / watchParts / pointer / liveView in public/app.js): the page Smith read last,
// what it is doing now, and a way to take over. Dark in either theme, like html.watching.
import { useEffect, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { Image } from "expo-image";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Btn, Dots, Grow, Icon, Press, Row, Screen, T } from "@/ui/kit";
import { ErrorView, Loading, NotFound } from "@/ui/states";
import { api, full, type Job } from "@/lib/api";
import { usePoll, useScreen } from "@/lib/load";
import { hostOf, isWeb } from "@/lib/format";
import { Hand, useMotion } from "@/screens/job/parts";

// The dark palette (app.css :root.watching), whatever the phone's theme.
const D = { ink: "#EEF2FF", mut: "#A9B4D0", field: "#1E2742", yel: "#FFC21A", cor: "#F4472F", navy: "#0B1B4D" };

type Data = { job: Job; credit: number };

// Piecewise keyframes, ease-in-out between stops, like the CSS keyframes they copy.
function kf(p: number, at: number[], v: number[]) {
  "worklet";
  for (let i = 1; i < at.length; i++) {
    if (p <= at[i]) {
      const s = (p - at[i - 1]) / (at[i] - at[i - 1] || 1);
      const e = s < 0.5 ? 2 * s * s : 1 - (-2 * s + 2) ** 2 / 2;
      return v[i - 1] + (v[i] - v[i - 1]) * e;
    }
  }
  return v[v.length - 1];
}
// @keyframes pointer and ring, in % of the page and 0..1 of the 7-second loop.
const P_AT = [0, 0.14, 0.17, 0.2, 0.4, 0.5, 0.53, 0.56, 0.72, 0.82, 0.85, 0.88, 0.94, 1];
const P_X = [45, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 45];
const P_Y = [55, 12, 12, 12, 12, 32, 32, 32, 32, 52, 52, 52, 52, 55];
const P_S = [1, 1, 0.8, 1, 1, 1, 0.8, 1, 1, 1, 0.8, 1, 1, 1];
const R_AT = [0, 0.16, 0.17, 0.51, 0.53, 0.84, 0.86, 0.96, 1];
const R_Y = [8, 8, 8, 8, 28, 28, 48, 48, 48];
const R_O = [0, 0, 1, 1, 1, 1, 1, 1, 0];

// The design's moving pointer: it glides to a row, clicks, and a yellow ring follows. It shows Smith at work,
// not where it clicks: Smith reads pages as text and clicks nothing. Motion off: the pointer rests, no ring.
function Pointer({ w, h }: { w: number; h: number }) {
  const on = useMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (on) t.value = withRepeat(withTiming(1, { duration: 7000, easing: Easing.linear }), -1, false);
  }, [on, t]);
  const ptr = useAnimatedStyle(() => ({
    transform: [{ translateX: (kf(t.value, P_AT, P_X) / 100) * w }, { translateY: (kf(t.value, P_AT, P_Y) / 100) * h }, { scale: kf(t.value, P_AT, P_S) }],
  }));
  const ring = useAnimatedStyle(() => ({ transform: [{ translateY: (kf(t.value, R_AT, R_Y) / 100) * h }], opacity: on ? kf(t.value, R_AT, R_O) : 0 }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, left: "4%", right: "4%", height: "16%", borderRadius: 14, borderWidth: 3, borderColor: D.yel }, ring]} />
      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0 }, ptr]}>
        <Svg width={26} height={26} viewBox="0 0 26 26"><Path d="M5 3l15 9-6.5 1.5L10 20z" fill="#0B1B4D" stroke="#FFFFFF" strokeWidth={2} strokeLinejoin="round" /></Svg>
      </Animated.View>
    </>
  );
}

// .onair: "สด" with a blinking dot (@keyframes blink, 1.2 s).
function OnAir() {
  const on = useMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (on) o.value = withRepeat(withSequence(withTiming(0.25, { duration: 0 }), withTiming(1, { duration: 480 }), withTiming(0.25, { duration: 480 }), withTiming(0.25, { duration: 240 })), -1);
  }, [on, o]);
  const s = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10, backgroundColor: D.cor }}>
      <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#FFFFFF" }, s]} />
      <T size={12} color="#FFFFFF" lh={1.2}>สด</T>
    </View>
  );
}

function Chip({ children, now }: { children: React.ReactNode; now?: boolean }) {
  const on = useMotion();
  return (
    <Animated.View entering={on ? FadeIn.duration(220) : undefined} exiting={on ? FadeOut.duration(150) : undefined} layout={on ? LinearTransition : undefined}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14, backgroundColor: now ? D.yel : D.field }}>
      {now ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: D.navy }} /> : <Icon name="check" size={14} color="#B8F0D2" />}
      <T font="prompt-600" size={12} color={now ? D.navy : "#B8F0D2"}>{children}</T>
    </Animated.View>
  );
}

function Watch({ j }: { j: Job }) {
  const { height } = useWindowDimensions();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const progress = j.progress || [];
  const now = progress.at(-1);
  const shot = j.live?.frame;
  const url = shot?.url || j.live?.page || ""; // the address bar names the page in the picture; before the first picture, the page being opened
  const searches = progress.filter((p) => p.text.startsWith("ค้นหา")).length;
  const pages = progress.filter((p) => p.host).length;
  const doing = !now ? "เริ่มงาน" : now.host ? `อ่าน ${now.host}` : now.text.startsWith("ค้นหา") ? "ค้นหา" : now.text;
  return (
    <>
      <View style={{ borderRadius: 22, backgroundColor: "#FFFFFF", overflow: "hidden" }}>
        <Row gap={8} style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "#EEF3FC" }}>
          <Icon name="lock" size={14} color="#4A5778" />
          <View style={{ flex: 1, height: 28, justifyContent: "center", paddingHorizontal: 12, borderRadius: 14, backgroundColor: "#FFFFFF" }}>
            <T size={12} color="#4A5778" numberOfLines={1} lh={1.2}>{url ? url.replace(/^https?:\/\/(www\.)?/, "") : "กำลังเปิดเว็บ"}</T>
          </View>
        </Row>
        <View onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} style={{ height: Math.min(height * 0.52, 440), backgroundColor: "#F6F8FC", overflow: "hidden" }}>
          {shot ? (
            <Image source={{ uri: full(shot.image) }} transition={{ duration: 350, effect: "cross-dissolve" }} contentFit="cover" contentPosition="top"
              accessibilityLabel={`หน้าเว็บ ${hostOf(shot.url)} ที่ Smith เปิดอ่าน`} style={{ width: "100%", height: "100%" }} />
          ) : (
            [8, 28, 48].map((top) => <View key={top} style={{ position: "absolute", left: "4%", right: "4%", top: `${top}%`, height: "16%", borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E3E9F6" }} />)
          )}
          {box.w > 0 && <Pointer w={box.w} h={box.h} />}
        </View>
      </View>
      <Row gap={6} style={{ flexWrap: "wrap" }}>
        <T size={15} lh={1.5} color={D.ink} accessibilityLiveRegion="polite">{now?.text || "Smith กำลังเริ่มงาน"}</T>
        <Dots color={D.ink} />
      </Row>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {searches ? <Chip key="s">{`ค้นหา ${searches} ครั้ง`}</Chip> : null}
        {pages ? <Chip key="p">{`เปิดอ่าน ${pages} เว็บ`}</Chip> : null}
        <Chip key="now" now>{doing}</Chip>
      </View>
    </>
  );
}

export default function LiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: res, error, reload, setData } = useScreen(() => api<Data>("GET", `/api/jobs/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const job = res?.ok ? res.data.job : null;
  const running = job?.status === "running";

  useEffect(() => {
    if (job && !running) router.replace(`/job/${id}` as Href);
  }, [job, running, id]);
  usePoll(async () => {
    const r = await api<Data>("GET", `/api/jobs/${id}`);
    if (r.ok) setData(r);
  }, 2000, running && !busy);

  if (error) return <ErrorView error={error} retry={reload} />;
  if (!res || (job && !running)) return <Loading />;
  if (!res.ok || !job) return <NotFound />;

  const takeover = async () => {
    const page = job.live?.frame?.url || job.live?.page || ""; // the page the address bar names
    if (isWeb(page)) WebBrowser.openBrowserAsync(page).catch(() => {}); // not awaited: Smith stops while the page opens
    setBusy(true);
    await api("POST", `/api/jobs/${id}/takeover`).catch(() => null); // answers once the job is settled
    router.replace(`/job/${id}` as Href);
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/job/${id}` as Href));

  return (
    <Screen dark>
      <Row gap={8} style={{ minHeight: 44, justifyContent: "space-between" }}>
        <Press onPress={back} label="กลับ" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: D.field, alignItems: "center", justifyContent: "center" }}>
          <Icon name="back" color={D.ink} />
        </Press>
        <Row gap={8} style={{ flex: 1, justifyContent: "center" }}>
          <T font="mitr-600" size={18} color="#FFFFFF" accessibilityRole="header">Smith กำลังทำ</T>
          <OnAir />
        </Row>
        <View style={{ width: 44 }} />
      </Row>
      <Watch j={job} />
      <Grow />
      <Btn title="ให้ฉันทำต่อเอง" icon={busy ? undefined : <Hand />} busy={busy && "กำลังหยุด"} onPress={takeover} />
      <T size={13} lh={1.5} color={D.mut} style={{ textAlign: "center" }}>เข้าไปทำเองเมื่อไร Smith หยุดทันที และไม่คิดเงินงานนี้</T>
    </Screen>
  );
}
