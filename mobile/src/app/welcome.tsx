// Onboarding (app.js SLIDES / welcome()): three slides you swipe or step through, each with its mascot and stickers
// that pop in one after another with a tilt, then bob. The last slide or "ข้าม" goes to consent.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, useWindowDimensions, type ViewStyle } from "react-native";
import { router, type Href } from "expo-router";
import Animated, {
  Easing, Extrapolation, interpolate, interpolateColor, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion,
  useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { Btn, Clouds, H1, Icon, Press, Row, Screen, T, lift, toneOf, useColors } from "@/ui/kit";
import { Mascot, type Pose } from "@/ui/Mascot";
import { usePrefs } from "@/lib/prefs";

type Spot = Pick<ViewStyle, "left" | "right" | "top" | "bottom">;
type PropSpec = { at: Spot; r: number; d: number; el: "say" | "sticker" | "checks" | "pic"; tone?: string; text?: string; icon?: "link" | "check" };
const SLIDES: { m: Pose; h: string; p: string; sparks?: boolean; props: PropSpec[] }[] = [
  {
    m: "idle", h: "บอกสิ่งที่อยากได้\nแล้วปล่อยให้ Smith\nไปทำแทนคุณ", p: "เทียบราคาของชิ้นใหญ่ หาตั๋ว หาที่พัก หาราคาส่ง พิมพ์มาเหมือนคุยกับเพื่อน",
    props: [
      { at: { left: 0, top: 6 }, r: -7, d: 0.25, el: "say", tone: "cor", text: "หาตั๋วไปเชียงใหม่" },
      { at: { right: 0, top: 44 }, r: 6, d: 0.4, el: "say", tone: "yel", text: "เทียบราคาหูฟัง" },
      { at: { left: "6%", bottom: 2 }, r: 4, d: 0.55, el: "say", tone: "grn", text: "หาที่พักภูเก็ต" },
    ],
  },
  {
    m: "work", h: "Smith บอกแผน\nและราคาก่อนลงมือ", p: "จ่ายไม่เกินราคาที่บอก ไม่สำเร็จ ไม่คิดเงิน",
    props: [
      { at: { right: "2%", top: 10 }, r: 9, d: 0.25, el: "sticker", text: "฿12" },
      { at: { left: 0, top: 54 }, r: -6, d: 0.4, el: "checks" },
    ],
  },
  {
    m: "done", h: "ผลงานมีลิงก์จริง\nให้เปิดตรวจเองได้", p: "มีภาพหน้าจอเมื่อเปิดหน้าเว็บได้ ผลไม่ตรง ขอเงินคืนได้ใน 24 ชั่วโมง", sparks: true,
    props: [
      { at: { left: 0, top: 30 }, r: -8, d: 0.25, el: "pic" },
      { at: { right: 0, top: 70 }, r: 7, d: 0.4, el: "say", tone: "blu", text: "ลิงก์หลักฐาน", icon: "link" },
      { at: { right: "8%", top: 0 }, r: -5, d: 0.55, el: "say", tone: "grn", text: "คืนเงินได้", icon: "check" },
    ],
  },
];

const useStill = () => {
  const { prefs } = usePrefs();
  return useReducedMotion() || !prefs.motion;
};

// ---------- the stickers (.say, .sticker, .mini)
function Sticker({ s, small }: { s: PropSpec; small: boolean }) {
  const c = useColors();
  if (s.el === "say") {
    const [b, f] = toneOf(c, s.tone);
    return (
      <View style={[{ flexDirection: "row", alignItems: "center", gap: 6, height: small ? 32 : 38, paddingHorizontal: small ? 10 : 14, borderRadius: 19, borderBottomLeftRadius: 6, backgroundColor: b }, lift(c)]}>
        {s.icon && <Icon name={s.icon} fill={s.icon === "check"} size={16} color={f} />}
        <T font="mitr" size={small ? 12 : 14} lh={1.2} color={f} numberOfLines={1}>{s.text}</T>
      </View>
    );
  }
  if (s.el === "sticker") {
    return (
      <View style={{ height: small ? 46 : 54, paddingHorizontal: 20, borderRadius: 18, backgroundColor: c.yel, justifyContent: "center", shadowColor: "#FFC21A", shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 }}>
        <T font="mitr-700" size={small ? 24 : 28} lh={1.2} color="#0B1B4D">{s.text}</T>
      </View>
    );
  }
  const bar = (key: number, style?: ViewStyle) => <View key={key} style={[{ height: 8, borderRadius: 4, backgroundColor: c.field }, style]} />;
  return (
    <View style={[{ width: small ? 84 : 104, padding: 10, gap: 7, borderRadius: 16, backgroundColor: c.surf }, lift(c)]}>
      {s.el === "checks"
        ? [0, 1, 2].map((i) => <Row key={i} gap={6}><Icon name="check" fill size={16} color={c.gtxt} />{bar(i, { flex: 1 })}</Row>)
        : [
            <Svg key="pic" height={48} width="100%">
              <Defs><LinearGradient id="pic" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={c.soft} /><Stop offset="1" stopColor={c.psoft} /></LinearGradient></Defs>
              <Rect width="100%" height={48} rx={10} fill="url(#pic)" />
            </Svg>,
            bar(1),
            bar(2, { width: "60%" }),
          ]}
    </View>
  );
}

// A sticker placed around the mascot: pops in with its tilt `d` seconds after the slide shows, then bobs (.prop).
function Prop({ s, active, children }: { s: PropSpec; active: boolean; children: ReactNode }) {
  const still = useStill();
  const pop = useSharedValue(still ? 1 : 0);
  const bob = useSharedValue(0);
  useEffect(() => {
    if (still) {
      pop.value = 1;
      bob.value = 0;
      return;
    }
    if (!active) {
      pop.value = withTiming(0, { duration: 150 }); // gone when you swipe away, so it pops again when you come back
      return;
    }
    const ms = s.d * 1000;
    pop.value = 0;
    pop.value = withDelay(ms, withSpring(1, { damping: 11, stiffness: 170 }));
    bob.value = -4;
    bob.value = withDelay(ms, withRepeat(withTiming(5, { duration: 3400, easing: Easing.inOut(Easing.ease) }), -1, true));
  }, [active, still, s.d, pop, bob]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.value * 1.6),
    transform: [{ translateY: bob.value }, { scale: 0.3 + 0.7 * pop.value }, { rotate: `${s.r * pop.value}deg` }],
  }));
  return <Animated.View style={[{ position: "absolute", zIndex: 1 }, s.at, style]}>{children}</Animated.View>;
}

// Three yellow stars twinkling around the happy mascot (.sparks).
function Spark({ x, y, delay }: { x: number; y: number; delay: number }) {
  const c = useColors();
  const still = useStill();
  const t = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    t.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), withTiming(0, { duration: 900, easing: Easing.inOut(Easing.ease) })), -1));
  }, [still, delay, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + 0.75 * t.value, transform: [{ scale: 0.6 + 0.4 * t.value }, { rotate: `${20 * t.value}deg` }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: "50%", marginLeft: x, top: y }, style]}>
      <Svg width={22} height={22} viewBox="0 0 20 20"><Path d="M10 0l2.2 7.8L20 10l-7.8 2.2L10 20l-2.2-7.8L0 10l7.8-2.2z" fill={c.yel} /></Svg>
    </Animated.View>
  );
}

// One slide. The mascot lags a little behind the swipe (parallax), the text fades with distance.
function Slide({ i, x, width, active }: { i: number; x: SharedValue<number>; width: number; active: boolean }) {
  const c = useColors();
  const still = useStill();
  const s = SLIDES[i];
  const small = width < 350; // small phones: stickers stay off the mascot's face
  const scene = useAnimatedStyle(() => {
    const d = x.value / width - i;
    return still ? {} : { transform: [{ translateX: d * width * 0.35 }, { scale: interpolate(Math.abs(d), [0, 1], [1, 0.85], Extrapolation.CLAMP) }] };
  });
  const text = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(x.value / width - i), [0, 0.7], [1, 0], Extrapolation.CLAMP) }));
  return (
    <View style={{ width, paddingHorizontal: 16, justifyContent: "center", alignItems: "center", gap: 14 }} accessibilityElementsHidden={!active} importantForAccessibility={active ? "auto" : "no-hide-descendants"}>
      <Animated.View style={[{ width: "100%", maxWidth: 340, paddingTop: 26, paddingBottom: 22 }, scene]}>
        <View style={{ minHeight: 150, alignItems: "center", justifyContent: "center" }}>
          <Mascot pose={s.m} />
          {s.sparks && <><Spark x={-96} y={18} delay={0} /><Spark x={78} y={4} delay={500} /><Spark x={92} y={84} delay={1000} /></>}
        </View>
        {s.props.map((p, k) => <Prop key={k} s={p} active={active}><Sticker s={p} small={small} /></Prop>)}
      </Animated.View>
      <Animated.View style={[{ gap: 14, alignItems: "center" }, text]}>
        <H1 size={30}>{s.h}</H1>
        <T size={16} lh={1.5} color={c.mut} style={{ textAlign: "center" }}>{s.p}</T>
      </Animated.View>
    </View>
  );
}

// The page dots: the current one stretches to a blue bar as you swipe (.slide-dots).
function Dot({ i, x, width }: { i: number; x: SharedValue<number>; width: number }) {
  const c = useColors();
  const style = useAnimatedStyle(() => {
    const on = interpolate(x.value / width, [i - 1, i, i + 1], [0, 1, 0], Extrapolation.CLAMP);
    return { width: 6 + 12 * on, backgroundColor: interpolateColor(on, [0, 1], [c.off, c.blue]) };
  });
  return <Animated.View style={[{ height: 6, borderRadius: 3 }, style]} />;
}

export default function Welcome() {
  const c = useColors();
  const still = useStill();
  const { width } = useWindowDimensions();
  const [slide, setSlide] = useState(0);
  const pager = useAnimatedRef<Animated.ScrollView>();
  const x = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { x.value = e.contentOffset.x; });
  const last = slide >= SLIDES.length - 1;
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    router.replace("/consent" as Href);
  };
  const next = () => {
    if (last) return finish();
    setSlide(slide + 1);
    pager.current?.scrollTo({ x: (slide + 1) * width, animated: !still });
  };
  return (
    <Screen scroll={false}>
      <Clouds />
      <Row gap={0} style={{ minHeight: 40 }}>
        <View style={{ width: 64 }} />
        <View style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 6 }} accessible={false} importantForAccessibility="no-hide-descendants">
          {SLIDES.map((_, i) => <Dot key={i} i={i} x={x} width={width} />)}
        </View>
        <View style={{ width: 64, alignItems: "flex-end" }}>
          {!last && (
            <Press onPress={finish} label="ข้าม" style={{ height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: c.soft, justifyContent: "center" }}>
              <T font="mitr-600" size={15} lh={1.2} color={c.link}>ข้าม</T>
            </Press>
          )}
        </View>
      </Row>
      <Animated.ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setSlide(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ flex: 1, marginHorizontal: -16 }}
      >
        {SLIDES.map((_, i) => <Slide key={i} i={i} x={x} width={width} active={i === slide} />)}
      </Animated.ScrollView>
      <Btn title={last ? "เริ่มเลย" : "ถัดไป"} onPress={next} />
    </Screen>
  );
}
