// Smith's mascots, redrawn from public/mascots.js (the design's rig) as native SVG layers moved by Reanimated.
// One clock drives every part; each part runs the same keyframes as the web rig (float, tilt, jiggle, ears, trunk,
// blink, hop). With reduced motion on the phone or "ภาพเคลื่อนไหว" off, the mascot stands still.
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, useReducedMotion } from "react-native-reanimated";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import { usePrefs } from "@/lib/prefs";

export type Pose = "idle" | "small" | "work" | "done" | "calm";

type PoseSpec = {
  size: number;
  cat?: boolean;
  float?: { dur: number; fx: number; fy: number; fy2: number };
  hop?: { dur: number; h: number };
  tilt: { dur: number; t: number };
  jiggle: number;
  ears: { kind: "ef" | "ctw"; dur: number };
  trunk?: { dur: number; rest?: number };
  blink?: number;
  shut?: boolean;
  extra?: "bubbles" | "dots" | "hearts";
};

// Timings and distances from the rig's CSS (.f-mi, .t-mi, .j-mi, .r-mi .ea, ...), in px at the pose's own size.
const POSES: Record<Pose, PoseSpec> = {
  idle: { size: 112, float: { dur: 3000, fx: 3, fy: -5.83, fy2: -9.33 }, tilt: { dur: 3600, t: 6 }, jiggle: 1800, ears: { kind: "ef", dur: 2800 }, trunk: { dur: 2600 }, blink: 3700, extra: "bubbles" },
  small: { size: 72, float: { dur: 3000, fx: 3, fy: -3.75, fy2: -6 }, tilt: { dur: 3600, t: 6 }, jiggle: 1800, ears: { kind: "ef", dur: 2800 }, trunk: { dur: 2600 }, blink: 3700, extra: "bubbles" },
  work: { size: 104, cat: true, float: { dur: 620, fx: 0, fy: -4.88, fy2: -6.5 }, tilt: { dur: 1300, t: 5 }, jiggle: 700, ears: { kind: "ctw", dur: 1400 }, blink: 2800, extra: "dots" },
  done: { size: 112, hop: { dur: 1300, h: 28 }, tilt: { dur: 2600, t: 4 }, jiggle: 1300, ears: { kind: "ef", dur: 1000 }, trunk: { dur: 1200, rest: -30 }, shut: true, extra: "hearts" },
  calm: { size: 96, float: { dur: 4000, fx: 1, fy: -3, fy2: -5 }, tilt: { dur: 5000, t: 3 }, jiggle: 3000, ears: { kind: "ef", dur: 4500 }, trunk: { dur: 3600 } },
};

// Piecewise keyframes with ease-in-out between stops, like CSS keyframes with an ease-in-out timing.
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
const phase = (t: number, dur: number, delay = 0) => {
  "worklet";
  return (((t - delay) % dur) + dur) % dur / dur;
};

export function Mascot({ pose = "idle", size }: { pose?: Pose; size?: number }) {
  const spec = POSES[pose];
  const px = size ?? spec.size;
  const k = px / spec.size; // rig distances are px at the pose's own size
  const reduced = useReducedMotion();
  const { prefs } = usePrefs();
  const still = reduced || !prefs.motion;
  const t = useSharedValue(0);
  useFrameCallback((f) => {
    t.value = f.timeSinceFirstFrame;
  }, !still);

  const body = useAnimatedStyle(() => {
    const c = t.value;
    const tr = [] as any[];
    if (spec.float) {
      const p = phase(c, spec.float.dur);
      const { fx, fy, fy2 } = spec.float;
      tr.push({ translateX: kf(p, [0, 0.25, 0.5, 0.75, 1], [0, fx, 0, -fx, 0]) * k }, { translateY: kf(p, [0, 0.25, 0.5, 0.75, 1], [0, fy, fy2, fy * 0.6, 0]) * k });
    }
    if (spec.hop) {
      const p = phase(c, spec.hop.dur);
      const h = spec.hop.h * k;
      const at = [0, 0.1, 0.26, 0.42, 0.58, 0.68, 0.8, 0.9, 1];
      tr.push({ translateY: kf(p, at, [0, 0, -0.85 * h, -h, 0, -0.12 * h, 0, 0, 0]) }, { scaleX: kf(p, at, [1, 1.14, 0.9, 1, 1.12, 0.96, 1.02, 1, 1]) }, { scaleY: kf(p, at, [1, 0.86, 1.12, 1, 0.88, 1.05, 0.98, 1, 1]) });
    }
    const pt = phase(c, spec.tilt.dur);
    tr.push({ rotate: `${kf(pt, [0, 0.25, 0.75, 1], [0, spec.tilt.t, -spec.tilt.t, 0])}deg` });
    const pj = phase(c, spec.jiggle);
    const at = [0, 0.25, 0.5, 0.75, 1];
    tr.push({ scaleX: kf(pj, at, [1, 1.045, 0.965, 1.04, 1]) }, { scaleY: kf(pj, at, [1, 0.955, 1.04, 0.96, 1]) }, { skewX: `${kf(pj, at, [0, 2.5, 0, -2.5, 0])}deg` });
    return { transform: tr };
  });

  const earAt = (side: 1 | -1, c: number) => {
    "worklet";
    if (spec.ears.kind === "ctw") {
      const p = phase(c, spec.ears.dur, side === 1 ? 0 : spec.ears.dur / 2);
      return { transform: [{ rotate: `${side * kf(p, [0, 0.05, 0.1, 0.15, 1], [0, -18, 5, 0, 0])}deg` }] };
    }
    const p = phase(c, spec.ears.dur, side === 1 ? 0 : 70);
    const at = [0, 0.08, 0.16, 0.24, 0.34, 1];
    return { transform: [{ rotate: `${side * kf(p, at, [0, -10, 4, -8, 0, 0])}deg` }, { scaleX: kf(p, at, [1, 0.8, 1.05, 0.84, 1, 1]) }] };
  };
  const earL = useAnimatedStyle(() => earAt(1, t.value));
  const earR = useAnimatedStyle(() => earAt(-1, t.value));
  const trunk = useAnimatedStyle(() => {
    const p = phase(t.value, spec.trunk?.dur ?? 1000);
    return { transform: [{ rotate: `${(spec.trunk?.rest ?? 0) + kf(p, [0, 0.3, 0.7, 1], [0, 9, -7, 0])}deg` }] };
  });
  const blink = useAnimatedStyle(() => {
    const p = phase(t.value, spec.blink ?? 1000, 300);
    return { transform: [{ scaleY: spec.blink ? kf(p, [0, 0.45, 0.49, 0.53, 1], [1, 1, 0.08, 1, 1]) : 1 }] };
  });

  // iOS clips SVG to its box, and the ears reach past the 0..100 square: each layer draws on a canvas 20 units
  // bigger on every side. `ox, oy` is the pivot in the rig's 0..100 units.
  const layer = (style: any, ox: number, oy: number, children: React.ReactNode) => (
    <Animated.View style={[{ position: "absolute", left: -0.2 * px, top: -0.2 * px, width: 1.4 * px, height: 1.4 * px, transformOrigin: `${(ox + 20) / 1.4}% ${(oy + 20) / 1.4}%` }, style]} pointerEvents="none">
      <Svg viewBox="-20 -20 140 140" width="100%" height="100%">{children}</Svg>
    </Animated.View>
  );

  const parts = spec.cat ? (
    <>
      {layer(earL, 36, 36.8, <G><Path d="M21 44L26 10Q28 4 33 8L51 28Z" fill="#FFC21A" stroke="#FFC21A" strokeWidth={6} strokeLinejoin="round" /><Path d="M28 35L30.5 17L41 28.5Z" fill="#FFB8D2" stroke="#FFB8D2" strokeWidth={3} strokeLinejoin="round" /></G>)}
      {layer(earR, 64, 36.8, <G><Path d="M79 44L74 10Q72 4 67 8L49 28Z" fill="#FFC21A" stroke="#FFC21A" strokeWidth={6} strokeLinejoin="round" /><Path d="M72 35L69.5 17L59 28.5Z" fill="#FFB8D2" stroke="#FFB8D2" strokeWidth={3} strokeLinejoin="round" /></G>)}
      {layer(null, 50, 50, <G>
        <Circle cx={50} cy={57} r={31} fill="#FFC21A" /><Circle cx={26} cy={70} r={19} fill="#FFC21A" /><Circle cx={74} cy={70} r={19} fill="#FFC21A" />
        <Ellipse cx={30} cy={66} rx={5.5} ry={3.4} fill="#FF8A6B" opacity={0.55} /><Ellipse cx={70} cy={66} rx={5.5} ry={3.4} fill="#FF8A6B" opacity={0.55} />
        <Path d="M46.5 64h7l-3.5 4z" fill="#FF7FAF" stroke="#FF7FAF" strokeWidth={2} strokeLinejoin="round" />
      </G>)}
      {layer(blink, 50, 56, <G><Ellipse cx={40} cy={56} rx={4.8} ry={7.2} fill="#0B1B4D" /><Ellipse cx={60} cy={56} rx={4.8} ry={7.2} fill="#0B1B4D" /></G>)}
    </>
  ) : (
    <>
      {layer(earL, 22.96, 41.6, <G><Ellipse cx={7} cy={47} rx={21} ry={27} fill="#0A4BFF" /><Ellipse cx={9} cy={48} rx={12.5} ry={17.5} fill="#FFB8D2" /></G>)}
      {layer(earR, 77.04, 41.6, <G><Ellipse cx={93} cy={47} rx={21} ry={27} fill="#0A4BFF" /><Ellipse cx={91} cy={48} rx={12.5} ry={17.5} fill="#FFB8D2" /></G>)}
      {layer(null, 50, 50, <G>
        <Rect x={28} y={28} width={44} height={44} rx={12} fill="#0A4BFF" />
        <Circle cx={33} cy={33} r={25} fill="#0A4BFF" /><Circle cx={67} cy={33} r={25} fill="#0A4BFF" /><Circle cx={67} cy={67} r={25} fill="#0A4BFF" /><Circle cx={33} cy={67} r={25} fill="#0A4BFF" />
        <Ellipse cx={29} cy={57} rx={5.5} ry={3.4} fill="#FF9ACB" opacity={0.8} /><Ellipse cx={71} cy={57} rx={5.5} ry={3.4} fill="#FF9ACB" opacity={0.8} />
      </G>)}
      {layer(trunk, 50, 54, <Path d="M50 54C50 68 48 80 50 89C51.5 95 58 97 61 92" stroke="#3A70FF" strokeWidth={11} strokeLinecap="round" fill="none" />)}
      {spec.shut
        ? layer(null, 50, 50, <Path d="M33.5 47q5.5 -7 11 0M55.5 47q5.5 -7 11 0" stroke="#FFFFFF" strokeWidth={4.6} strokeLinecap="round" fill="none" />)
        : layer(blink, 50, 45, <G><Ellipse cx={39} cy={45} rx={4.8} ry={7.2} fill="#FFFFFF" /><Ellipse cx={61} cy={45} rx={4.8} ry={7.2} fill="#FFFFFF" /></G>)}
    </>
  );

  return (
    <View style={{ width: px, height: px }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: spec.hop ? "50% 100%" : "50% 90%" }, body]}>{parts}</Animated.View>
      {spec.extra && <Extras kind={spec.extra} px={px} k={k} t={t} />}
    </View>
  );
}

// Small things around a pose: floating bubbles, "thinking" dots above the cat, hearts rising from a finished job.
function Extras({ kind, px, k, t }: { kind: "bubbles" | "dots" | "hearts"; px: number; k: number; t: { value: number } }) {
  const items = kind === "bubbles"
    ? [{ x: 1, y: 0.8, w: 0.13, d: 300 }, { x: 0.84, y: 0.98, w: 0.1, d: 550 }]
    : kind === "dots"
      ? [0, 1, 2].map((i) => ({ x: 37 / 104 + (i * 12) / 104, y: -22.88 / 104, w: 8 / 104, d: i * 150 }))
      : [{ x: 0.72, y: 0.02, w: 0.2, d: 0, hx: 8 }, { x: 0.1, y: 0.12, w: 0.2, d: 600, hx: -10 }, { x: 0.46, y: -0.1, w: 0.2, d: 1200, hx: 4 }];
  return (
    <>
      {items.map((it: any, i) => <Extra key={i} kind={kind} it={it} px={px} k={k} t={t} />)}
    </>
  );
}
function Extra({ kind, it, px, k, t }: any) {
  const style = useAnimatedStyle(() => {
    const c = t.value;
    if (kind === "dots") return { transform: [{ translateY: kf(phase(c, 900, it.d), [0, 0.3, 0.6, 1], [0, -6, 0, 0]) * k }] };
    if (kind === "hearts") {
      const p = phase(c, 1800, it.d);
      const at = [0, 0.12, 0.7, 1];
      return {
        opacity: kf(p, at, [0, 1, 1, 0]),
        transform: [{ translateX: kf(p, at, [0, 0, it.hx * 0.7, it.hx]) * k }, { translateY: kf(p, at, [0, -6, -36, -50]) * k }, { scale: kf(p, at, [0, 1.15, 0.95, 0.8]) }],
      };
    }
    const p = phase(c, 3000, it.d);
    return { transform: [{ translateX: kf(p, [0, 0.25, 0.5, 0.75, 1], [0, 3, 0, -3, 0]) * k }, { translateY: kf(p, [0, 0.25, 0.5, 0.75, 1], [0, -5.83, -9.33, -3.5, 0]) * k }] };
  });
  const w = it.w * px;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: it.x * px, top: it.y * px, width: w, height: w }, style]}>
      {kind === "dots"
        ? <View style={{ width: w, height: w, borderRadius: w / 2, backgroundColor: "#0A4BFF" }} />
        : <Svg viewBox="0 0 20 20" width={w} height={w}>
          {kind === "hearts"
            ? <Path d="M10 18C4 13.9 1.4 10.8 1.4 7.4 1.4 4.7 3.5 2.6 6.1 2.6c1.6 0 3 .8 3.9 2.2.9-1.4 2.3-2.2 3.9-2.2 2.6 0 4.7 2.1 4.7 4.8 0 3.4-2.6 6.5-8.6 10.6z" fill="#F4472F" />
            : <Circle cx={10} cy={10} r={9.5} fill="#0A4BFF" />}
        </Svg>}
    </Animated.View>
  );
}
