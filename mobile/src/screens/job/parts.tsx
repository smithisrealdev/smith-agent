// Small pieces shared by the job, live, refund and history screens (public/app.js helpers of the same names).
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { router, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { isWeb } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";

export const goHome = () => router.dismissTo("/" as Href); // back to the home screen if it is under us, else replace
export const openWeb = (url?: string | null) => {
  if (isWeb(url)) WebBrowser.openBrowserAsync(url as string).catch(() => {});
};
// The product's picture, when its page had one (picture() in app.js).
export const pictureOf = (o?: { image?: string } | null) => (/^\/evidence\/[\w-]+\.(png|jpg|webp)$/.test(o?.image || "") ? (o!.image as string) : "");

export const useMotion = () => {
  const { prefs } = usePrefs();
  const reduced = useReducedMotion();
  return prefs.motion && !reduced;
};

// The four-point star of SPARK in app.js.
export const Star = ({ size = 22, color = "#FFC21A" }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20"><Path d="M10 0l2.2 7.8L20 10l-7.8 2.2L10 20l-2.2-7.8L0 10l7.8-2.2z" fill={color} /></Svg>
);

// .sparks: three stars twinkling around the done mascot (@keyframes twinkle, 1.8 s, 0.5 s apart).
function Twinkle({ delay, style }: { delay: number; style: object }) {
  const p = useSharedValue(0);
  const on = useMotion();
  useEffect(() => {
    if (on) p.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), withTiming(0, { duration: 900, easing: Easing.inOut(Easing.ease) })), -1));
  }, [on, delay, p]);
  const s = useAnimatedStyle(() => ({ opacity: on ? 0.25 + 0.75 * p.value : 1, transform: [{ scale: on ? 0.6 + 0.4 * p.value : 1 }, { rotate: `${20 * p.value}deg` }] }));
  return <Animated.View style={[{ position: "absolute" }, style, s]}><Star /></Animated.View>;
}
export const Sparks = () => (
  <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
    <Twinkle delay={0} style={{ left: "50%", marginLeft: -96, top: 18 }} />
    <Twinkle delay={500} style={{ left: "50%", marginLeft: 78, top: 4 }} />
    <Twinkle delay={1000} style={{ left: "50%", marginLeft: 92, top: 84 }} />
  </View>
);

// The success burst when a job finishes while the user watches: stars fly out from the mascot and fade.
const RAYS = Array.from({ length: 10 }, (_, i) => ({ a: (i / 10) * Math.PI * 2 + 0.3, d: 90 + (i % 3) * 22, s: 14 + (i % 3) * 5, c: i % 2 ? "#FFC21A" : i % 4 ? "#0A4BFF" : "#F4472F" }));
function Ray({ a, d, s, c }: (typeof RAYS)[number]) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(120, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [p]);
  const st = useAnimatedStyle(() => ({
    opacity: p.value < 0.6 ? 1 : 1 - (p.value - 0.6) / 0.4,
    transform: [{ translateX: Math.cos(a) * d * p.value }, { translateY: Math.sin(a) * d * p.value }, { scale: 0.3 + p.value }, { rotate: `${p.value * 90}deg` }],
  }));
  return <Animated.View style={[{ position: "absolute", left: "50%", top: "50%", marginLeft: -s / 2, marginTop: -s / 2 }, st]}><Star size={s} color={c} /></Animated.View>;
}
export function Burst() {
  if (!useMotion()) return null;
  return <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>{RAYS.map((r, i) => <Ray key={i} {...r} />)}</View>;
}

// HAND in app.js: "ให้ฉันทำต่อเอง".
export const Hand = ({ color = "#FFFFFF" }: { color?: string }) => (
  <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
    <Path d="M8 10V4.5a1.5 1.5 0 013 0V9M11 9V3.5a1.5 1.5 0 013 0V10M14 10V6a1.5 1.5 0 013 0v6a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L3 12a1.5 1.5 0 012.5-1.7L8 13" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
