// The web app's building blocks (.btn, .card, .note, .pill, .tile, .topbar, ...) as native components, with the
// press feel the founder asked for: scale down fast, spring back, a light haptic.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextProps, type TextInputProps, type ViewStyle, type StyleProp } from "react-native";
import Animated, { FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming, withDelay, useReducedMotion } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import Svg, { SvgXml } from "react-native-svg";
import { ICONS } from "./icon-data";
import { useColors, lift, tone as toneOf, type Colors } from "./theme";
import { usePrefs } from "@/lib/prefs";
import { full } from "@/lib/api";

export { useColors, lift, toneOf };
export type { Colors };

// ---------- text: Prompt for reading, Mitr for headings and numbers (the web app's two fonts)
const FONT = { prompt: "Prompt_400Regular", "prompt-500": "Prompt_500Medium", "prompt-600": "Prompt_600SemiBold", mitr: "Mitr_500Medium", "mitr-600": "Mitr_600SemiBold", "mitr-700": "Mitr_700Bold" };
type Font = keyof typeof FONT;
export function T({ size = 15, font = "prompt", color, lh = 1.45, style, ...rest }: TextProps & { size?: number; font?: Font; color?: string; lh?: number }) {
  const c = useColors();
  const { prefs } = usePrefs();
  const s = size * (prefs.big ? 1.18 : 1); // "ตัวหนังสือใหญ่"
  return <Text {...rest} style={[{ fontFamily: FONT[font], fontSize: s, lineHeight: s * lh, color: color ?? c.ink }, style]} />;
}
export const H1 = ({ size = 28, ...p }: TextProps & { size?: number; color?: string }) => <T accessibilityRole="header" font="mitr-700" size={size} lh={1.2} {...p} style={[{ textAlign: "center" }, p.style]} />;
export const Sect = (p: TextProps) => <T font="mitr-600" size={17} {...p} style={[{ paddingHorizontal: 4, paddingTop: 2 }, p.style]} />;
export const Muted = ({ small, ...p }: TextProps & { small?: boolean; size?: number }) => {
  const c = useColors();
  return <T size={small ? 13 : 15} color={c.mut} {...p} />;
};

// ---------- icons (Phosphor, from public/icons.js): bold for controls and text, fill inside tiles and chips
export type IconName = keyof typeof ICONS.bold;
export function Icon({ name, fill, size = 20, color }: { name: IconName | string; fill?: boolean; size?: number; color?: string }) {
  const c = useColors();
  const d = ((fill ? ICONS.fill : ICONS.bold) as Record<string, string>)[name] || "";
  return <SvgXml xml={`<svg viewBox="0 0 256 256" fill="currentColor">${d}</svg>`} width={size} height={size} color={color ?? c.ink} />;
}
export const LineMark = ({ size = 24 }: { size?: number }) => <SvgXml xml={`<svg viewBox="0 0 24 24" fill="#FFFFFF">${ICONS.line}</svg>`} width={size} height={size} />;

// ---------- pressing: scale down fast, back with a little spring, a light tap on the hand
export function Press({ onPress, disabled, style, children, scale = 0.95, haptic = true, label, role = "button", selected }: {
  onPress?: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode; scale?: number; haptic?: boolean; label?: string; role?: "button" | "link" | "switch" | "tab"; selected?: boolean;
}) {
  const s = useSharedValue(1);
  const reduced = useReducedMotion();
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const flex = StyleSheet.flatten(style)?.flex; // the style sits on the inner view, so the Pressable must grow too or a card can't fill its row
  return (
    <Pressable
      style={flex ? { flex } : undefined}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      onPressIn={() => { if (!reduced) s.set(withTiming(scale, { duration: 80 })); }}
      onPressOut={() => s.set(withSpring(1, { damping: 12, stiffness: 260 }))}
      onPress={() => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
    >
      <Animated.View style={[style, anim]}>{children}</Animated.View>
    </Pressable>
  );
}

// ---------- buttons (.btn and its kinds). Busy keeps the colour, says what it does, and ignores taps.
type BtnKind = "primary" | "second" | "danger" | "line" | "text-danger";
export function Btn({ title, onPress, kind = "primary", disabled, busy, icon, iconRight }: { title: string; onPress?: () => void | Promise<unknown>; kind?: BtnKind; disabled?: boolean; busy?: string | boolean; icon?: ReactNode; iconRight?: ReactNode }) {
  const c = useColors();
  const bg = disabled ? c.line : { primary: c.blue, second: c.soft, danger: c.dangerbg, line: "#06C755", "text-danger": "transparent" }[kind];
  const fg = disabled ? c.mut : { primary: "#FFFFFF", second: c.link, danger: "#FFFFFF", line: "#FFFFFF", "text-danger": c.rtxt }[kind];
  const big = kind === "primary" || kind === "danger" || kind === "line";
  const h = big ? 56 : kind === "second" ? 52 : 48;
  return (
    <Press disabled={disabled} onPress={busy ? undefined : onPress} label={title} style={{ height: h, borderRadius: h / 2, backgroundColor: bg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 16 }}>
      {icon}
      <T font={big ? "mitr-600" : "prompt"} size={big ? 18 : kind === "second" ? 16 : 15} color={fg} numberOfLines={1}>{typeof busy === "string" ? busy : title}</T>
      {busy ? <Dots color={fg} /> : iconRight}
    </Press>
  );
}
export function LinkBtn({ title, onPress, icon }: { title: string; onPress: () => void; icon?: IconName }) {
  const c = useColors();
  return (
    <Press onPress={onPress} scale={0.97} role="link" style={{ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center" }}>
      {icon && <Icon name={icon} size={18} color={c.link} />}
      <T font="prompt-600" size={14} color={c.link}>{title}</T>
    </Press>
  );
}
export function IconBtn({ name, onPress, label }: { name: IconName; onPress: () => void; label: string }) {
  const c = useColors();
  return (
    <Press onPress={onPress} label={label} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.field, alignItems: "center", justifyContent: "center" }}>
      <Icon name={name} color={c.ink} />
    </Press>
  );
}

// ---------- "…" while something is on its way (.dots): three dots bouncing in turn
export function Dots({ color }: { color?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 3, alignItems: "center" }} accessible={false}>
      {[0, 1, 2].map((i) => <Dot key={i} i={i} color={color ?? c.link} />)}
    </View>
  );
}
function Dot({ i, color }: { i: number; color: string }) {
  const y = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!reduced) y.value = withDelay(i * 150, withRepeat(withSequence(withTiming(-4, { duration: 270 }), withTiming(0, { duration: 270 }), withTiming(0, { duration: 360 })), -1));
  }, [i, reduced, y]);
  const s = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }, s]} />;
}

// ---------- a screen: the page colour, safe areas, 16px sides, 14px between blocks (#app in app.css)
export function Screen({ children, scroll = true, dark, footer, refreshing }: { children: ReactNode; scroll?: boolean; dark?: boolean; footer?: ReactNode; refreshing?: ReactNode }) {
  const c = useColors();
  const bg = dark ? "#0B1020" : c.page;
  const body = { padding: 16, paddingTop: 8, gap: 14, flexGrow: 1 } as const;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top", "left", "right", ...(footer ? [] : ["bottom" as const])]}>
      {refreshing}
      {scroll ? <ScrollView contentContainerStyle={body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>{children}</ScrollView> : <View style={body}>{children}</View>}
      {footer}
    </SafeAreaView>
  );
}
export const Grow = () => <View style={{ flexGrow: 1 }} />;
export const Row = ({ children, gap = 12, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) => <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
export const Col = ({ children, gap = 8, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) => <View style={[{ gap }, style]}>{children}</View>;
export const Center = ({ children, gap = 8, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) => <View style={[{ alignItems: "center", gap }, style]}>{children}</View>;

// A block that rises in when it first shows (.enter), unless motion is off.
export function Enter({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const { prefs } = usePrefs();
  const reduced = useReducedMotion();
  if (reduced || !prefs.motion) return <View style={style}>{children}</View>;
  return <Animated.View style={style} entering={FadeInDown.duration(220).delay(delay)} exiting={FadeOut.duration(120)}>{children}</Animated.View>;
}

// ---------- top bar: back, a centred title, something on the right
export function TopBar({ title, back = true, onBack, right, dark }: { title?: ReactNode; back?: boolean; onBack?: () => void; right?: ReactNode; dark?: boolean }) {
  return (
    <Row gap={8} style={{ minHeight: 44, justifyContent: "space-between" }}>
      {back ? <IconBtn name="back" label="กลับ" onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/")))} /> : <View style={{ width: 44 }} />}
      <View style={{ flex: 1, alignItems: "center" }}>{typeof title === "string" ? <T font="mitr-600" size={18} numberOfLines={1} color={dark ? "#FFFFFF" : undefined}>{title}</T> : title}</View>
      {right ?? <View style={{ width: 44 }} />}
    </Row>
  );
}

// ---------- surfaces
export function Card({ children, pad = true, style }: { children: ReactNode; pad?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.surf, borderRadius: 24 }, lift(c), pad && { paddingVertical: 14, paddingHorizontal: 16, gap: 8 }, style]}>{children}</View>;
}
export function Note({ children, tone, icon = "info", bg }: { children: ReactNode; tone?: "warn" | "bad" | "good"; icon?: IconName | null; bg?: string }) {
  const c = useColors();
  const [b, f] = tone ? toneOf(c, tone) : [bg ?? c.field, c.ink];
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18, backgroundColor: b }}>
      {icon && <View style={{ marginTop: 2 }}><Icon name={icon} color={f} /></View>}
      <View style={{ flex: 1, gap: 6 }}>{typeof children === "string" ? <T size={14} lh={1.5} color={f}>{children}</T> : children}</View>
    </View>
  );
}
// Text inside a note takes the note's colour.
export const NoteText = ({ tone, bold, ...p }: TextProps & { tone?: string; bold?: boolean }) => {
  const c = useColors();
  return <T size={14} lh={1.5} font={bold ? "prompt-600" : "prompt"} color={tone ? toneOf(c, tone)[1] : c.ink} {...p} />;
};
export function Pill({ children, tone, icon }: { children: ReactNode; tone?: "good" | "bad" | "warn" | "grey"; icon?: IconName }) {
  const c = useColors();
  const [b, f] = toneOf(c, tone);
  return (
    <View style={{ flexDirection: "row", alignSelf: "center", alignItems: "center", gap: 6, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 14, backgroundColor: b }}>
      {icon && <Icon name={icon} size={14} color={f} />}
      <T font="prompt-600" size={13} color={f}>{children}</T>
    </View>
  );
}
// A square with an icon (.tile), and optionally a site's logo or a product picture on top of it.
export function Tile({ icon, tone, bare, size = 40, iconSize, logo, photo }: { icon: string; tone?: string; bare?: boolean; size?: number; iconSize?: number; logo?: string; photo?: string }) {
  const c = useColors();
  const [b, f] = toneOf(c, tone);
  return (
    <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: bare ? "transparent" : b, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} fill size={iconSize ?? (bare ? 28 : 22)} color={bare && !tone ? c.link : f} />
      {(logo || photo) && <Logo uri={photo || `/logo/${logo}.png`} photo={!!photo} />}
    </View>
  );
}
// A logo or picture laid over its tile; a missing one just leaves the icon showing.
export function Logo({ uri, photo, style }: { uri: string; photo?: boolean; style?: StyleProp<any> }) {
  const c = useColors();
  const { prefs } = usePrefs();
  const [gone, setGone] = useState(false);
  if (gone || !prefs.pictures) return null;
  return (
    <Image source={{ uri: full(uri) }} onError={() => setGone(true)} contentFit={photo ? "cover" : "contain"} transition={150}
      style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: c.line, padding: photo ? 0 : 6 }, style]} />
  );
}
export const Money = ({ children, plus }: { children: ReactNode; plus?: boolean }) => {
  const c = useColors();
  return <T font="mitr-600" size={16} color={plus ? c.gtxt : undefined}>{children}</T>;
};
// A list in a card, rows split by a dashed line (.card.list .item).
export function List({ children }: { children: ReactNode[] | ReactNode }) {
  const c = useColors();
  const rows = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <Card pad={false} style={{ paddingHorizontal: 16 }}>
      {rows.map((r, i) => <View key={i} style={i ? { borderTopWidth: 1.5, borderStyle: "dashed", borderColor: c.dash } : null}>{r}</View>)}
    </Card>
  );
}
export function Item({ children, onPress, label }: { children: ReactNode; onPress?: () => void; label?: string }) {
  const inner = <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingVertical: 8 }}>{children}</View>;
  return onPress ? <Press onPress={onPress} scale={0.98} haptic={false} label={label} role="link">{inner}</Press> : inner;
}

// ---------- the user's words (.bubble) and Smith's (.bubble.smith)
export function Bubble({ text, smith, children }: { text: string; smith?: boolean; children?: ReactNode }) {
  const c = useColors();
  return (
    <View accessibilityLabel={`${smith ? "Smith" : "คุณ"}: ${text}`} style={[{ maxWidth: "85%", paddingVertical: 12, paddingHorizontal: 16, gap: 10 }, smith
      ? [{ alignSelf: "flex-start", backgroundColor: c.surf, borderRadius: 22, borderBottomLeftRadius: 6 }, lift(c)]
      : { alignSelf: "flex-end", backgroundColor: c.inkbg, borderRadius: 22, borderBottomRightRadius: 6 }]}>
      <T size={15} selectable color={smith ? c.ink : "#FFFFFF"}>{text}</T>
      {children}
    </View>
  );
}

// ---------- inputs
export const Field = ({ style, ...p }: TextInputProps) => {
  const c = useColors();
  const { prefs } = usePrefs();
  return <TextInput placeholderTextColor={c.ph} {...p} style={[{ borderRadius: 16, backgroundColor: c.field, paddingVertical: 14, paddingHorizontal: 16, fontSize: 16 * (prefs.big ? 1.18 : 1), fontFamily: "Prompt_400Regular", color: c.ink }, style]} />;
};
// One line and a send button (.chat-box): Enter sends too.
export function ChatBox({ placeholder, onSend, busy, max = 500, empty = "พิมพ์ข้อความก่อน" }: { placeholder: string; onSend: (text: string) => Promise<boolean | void>; busy?: boolean; max?: number; empty?: string }) {
  const c = useColors();
  const toast = useToast();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (sending) return;
    if (!t) return toast(empty);
    setSending(true);
    const ok = await onSend(t).finally(() => setSending(false));
    if (ok !== false) setText(""); // a refused message stays in the box, to send again
  };
  return (
    <Row gap={8}>
      <TextInput value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={c.ph} maxLength={max} returnKeyType="send" onSubmitEditing={send} accessibilityLabel={placeholder}
        style={{ flex: 1, height: 52, paddingHorizontal: 18, borderRadius: 26, backgroundColor: c.field, color: c.ink, fontSize: 16, fontFamily: "Prompt_400Regular" }} />
      <Press onPress={send} label="ส่ง" style={{ height: 52, minWidth: 72, paddingHorizontal: 18, borderRadius: 26, backgroundColor: c.blue, alignItems: "center", justifyContent: "center" }}>
        {sending || busy ? <ActivityIndicator color="#FFFFFF" /> : <T font="mitr-600" size={16} color="#FFFFFF">ส่ง</T>}
      </Press>
    </Row>
  );
}
export function Chip({ label, onPress, pressed, tone, icon, big }: { label: string; onPress: () => void; pressed?: boolean; tone?: string; icon?: string; big?: boolean }) {
  const c = useColors();
  const [b, f] = pressed ? [c.dark ? c.blue : c.inkbg, "#FFFFFF"] : tone ? toneOf(c, tone) : [c.soft, c.ink];
  return (
    <Press onPress={onPress} selected={pressed} label={label} style={{ minHeight: big ? 46 : 44, paddingHorizontal: 16, borderRadius: 23, backgroundColor: b, flexDirection: "row", alignItems: "center", gap: 6 }}>
      {icon && <Icon name={icon} fill size={20} color={f} />}
      <T font={big ? "mitr" : "prompt-500"} size={14} color={f}>{label}</T>
    </Press>
  );
}
// A segmented control whose thumb slides to the chosen segment (.seg).
export function Seg({ items, value, onChange }: { items: string[]; value: number; onChange: (i: number) => void }) {
  const c = useColors();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withSpring((w / items.length) * value, { damping: 18, stiffness: 220 });
  }, [value, w, items.length, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width - 8)} style={{ flexDirection: "row", padding: 4, borderRadius: 22, backgroundColor: c.field }}>
      {w > 0 && <Animated.View style={[{ position: "absolute", top: 4, left: 4, bottom: 4, width: w / items.length, borderRadius: 18, backgroundColor: c.surf }, lift(c), thumb]} />}
      {items.map((label, i) => (
        <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: i === value }} onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(i); }} style={{ flex: 1, height: 36, alignItems: "center", justifyContent: "center" }}>
          <T font={i === value ? "prompt-600" : "prompt"} size={14} color={i === value ? c.ink : c.mut}>{label}</T>
        </Pressable>
      ))}
    </View>
  );
}

// ---------- a short message at the bottom of the screen (.toast)
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = (text: string) => {
    clearTimeout(timer.current);
    setMsg({ text, n: Date.now() });
    timer.current = setTimeout(() => setMsg(null), 3200);
  };
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <Animated.View key={msg.n} entering={FadeInDown.duration(200)} exiting={FadeOut.duration(200)} pointerEvents="none" accessibilityLiveRegion="polite" accessibilityRole="alert"
          style={{ position: "absolute", left: 16, right: 16, bottom: 48, alignItems: "center" }}>
          <View style={{ backgroundColor: "#0B1B4D", borderRadius: 18, paddingVertical: 12, paddingHorizontal: 18 }}>
            <T color="#FFFFFF" size={14} style={{ textAlign: "center" }}>{msg.text}</T>
          </View>
        </Animated.View>
      )}
    </ToastCtx.Provider>
  );
}

// ---------- the soft clouds behind the welcome screens (.clouds), as two blurred-looking discs
export function Clouds() {
  const c = useColors();
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: -60, left: -80, right: -80, height: 320 }}>
      <Svg width="100%" height="100%" viewBox="0 0 400 320">
        <SvgXml xml={`<svg viewBox="0 0 400 320"><defs><radialGradient id="a"><stop offset="0" stop-color="${c.soft}"/><stop offset="1" stop-color="${c.soft}" stop-opacity="0"/></radialGradient></defs><circle cx="90" cy="120" r="140" fill="url(#a)"/><circle cx="320" cy="90" r="120" fill="url(#a)"/></svg>`} width="100%" height="100%" />
      </Svg>
    </View>
  );
}
