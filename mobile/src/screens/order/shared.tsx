// Shared by home, talk and quote: the chat entry the server really sends, why a message was refused,
// motion on/off, reload-on-return, and a number that counts up.
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { T } from "@/ui/kit";
import { usePrefs } from "@/lib/prefs";
import { baht, NO } from "@/lib/format";
import type { Res } from "@/lib/api";

// GET/POST /api/talk (talkView in src/web.js): a job reply carries that job's current state, not just its id.
export type TalkJob = { id: number; status: string; price: number; title: string };
export type TalkEntry = { role: "user" | "smith"; text: string; at: string; job: TalkJob | null };

export const talkRefused = (r: Res) => (r.data?.error === "talk_busy" ? "Smith กำลังตอบข้อความก่อนหน้า รอสักครู่" : NO[r.status] || "ระบบขัดข้อง ลองใหม่อีกครั้ง");

export function useMotion() {
  const { prefs } = usePrefs();
  const reduced = useReducedMotion();
  return prefs.motion && !reduced;
}

// The web app redraws a screen each time it is routed to; a native stack keeps it mounted, so refresh on return.
export function useRefocus(fn: () => unknown) {
  const first = useRef(true);
  const f = useRef(fn);
  f.current = fn;
  useFocusEffect(
    useCallback(() => {
      if (first.current) first.current = false;
      else f.current();
    }, []),
  );
}

// A baht amount that counts up to its value (ease-out, 700 ms), or just shows it when motion is off.
export function CountUp({ value, size, font = "mitr-700", color, lh, letterSpacing = -1 }: { value: number; size: number; font?: "mitr-700" | "mitr-600"; color?: string; lh?: number; letterSpacing?: number }) {
  const motion = useMotion();
  const [n, setN] = useState(motion ? 0 : value);
  const now = useRef(n);
  now.current = n;
  useEffect(() => {
    if (!motion) return setN(value);
    const from = now.current;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / 700);
      setN(Math.round(from + (value - from) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, motion]);
  return <T font={font} size={size} lh={lh ?? 1.05} color={color} accessibilityLabel={baht(value)} style={{ letterSpacing }}>{baht(n)}</T>;
}
