// HOME (home(), homeParts(), homeView() and the send/compose/template actions in public/app.js): a top bar, the bento
// grid, and the order box docked at the bottom. Polling while a job runs refreshes only the data, so the box keeps its text.
import { useEffect, useRef, useState, type ComponentRef, type RefObject } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import Animated, { SlideInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect, router, type Href } from "expo-router";
import { Chip, Dots, Icon, IconBtn, Press, Screen, T, lift, useColors, useToast } from "@/ui/kit";
import { ErrorView, Loading } from "@/ui/states";
import { api, type Job, type Me } from "@/lib/api";
import { failMessage, usePoll, useScreen } from "@/lib/load";
import { usePrefs } from "@/lib/prefs";
import { registerPush } from "@/lib/push";
import { baht } from "@/lib/format";
import { Bento } from "@/screens/order/bento";
import { talkRefused, useMotion, useRefocus } from "@/screens/order/shared";

// One example per buyer group in founder/customer.json, all where the saving is worth the fee (founder/pricing.md).
const TEMPLATES = [
  { label: "เทียบราคาของชิ้นใหญ่", icon: "tag", tone: "cor", text: "เทียบราคา [ชื่อสินค้าและรุ่น] จากหลายร้าน พร้อมลิงก์และโค้ดส่วนลดถ้ามี" },
  { label: "เทียบค่าส่งพัสดุ", icon: "list", tone: "grn", text: "เทียบค่าส่งพัสดุ [น้ำหนัก] กก. จาก [จังหวัดต้นทาง] ไป [จังหวัดปลายทาง] สัปดาห์ละ [จำนวน] กล่อง เจ้าไหนถูกที่สุด" },
  { label: "เช็กค่าธรรมเนียมร้านออนไลน์", icon: "wallet", tone: "yel", text: "ขาย [สินค้า] บน [Shopee/Lazada/TikTok] เดือนละ [ยอดขาย] บาท ตอนนี้โดนหักค่าธรรมเนียมกี่ % ได้สิทธิ์ลดค่าธรรมเนียมไหม ต้องจดทะเบียนอะไร" },
  { label: "หาโรงงาน OEM", icon: "shield", tone: "blu", text: "หาโรงงานผลิต [สินค้า] OEM ขั้นต่ำไม่เกิน [จำนวน] ชิ้น มีมาตรฐาน [เช่น GMP] เทียบ 5 เจ้า" },
  { label: "หาตั๋วเครื่องบิน", icon: "plane", tone: "blu", text: "หาตั๋วเครื่องบินไป [เมือง] วันที่ [วัน] กลับวันที่ [วัน] ราคาถูกสุด รวมกระเป๋า" },
  { label: "หาที่พักวันหยุดยาว", icon: "plane", tone: "grn", text: "หาที่พักที่ [จังหวัด] วันที่ [วัน] ถึง [วัน] สำหรับ [จำนวน] คน งบไม่เกิน [บาท] ต่อคืน" },
  { label: "หาราคาส่งเข้าร้าน", icon: "receipt", tone: "yel", text: "หาราคาส่ง [สินค้า] จำนวน [จำนวน] ชิ้น จากหลายร้าน รวมค่าส่ง" },
];

type Home = { me: Me; jobs: Job[] };
async function loadHome(): Promise<Home> {
  const [me, list] = await Promise.all([api<Me>("GET", "/api/me"), api<{ jobs: Job[] }>("GET", "/api/jobs")]);
  if (!me.ok || !list.ok) throw new Error(`home ${me.status}/${list.status}`);
  return { me: me.data, jobs: list.data.jobs || [] };
}

export default function Index() {
  const { consent } = usePrefs();
  if (!consent) return <Redirect href={"/welcome" as Href} />; // the web app sends people without consent to the welcome slides
  return <HomeScreen />;
}

function HomeScreen() {
  const { data, error, reload, setData } = useScreen(loadHome);
  const box = useRef<ComponentRef<typeof TextInput>>(null);
  // A refresh that fails keeps the old cards (usePoll tries again in 5 s) instead of swapping in the error view.
  const refresh = async () => setData(await loadHome());
  const running = !!data?.jobs.some((j) => j.status === "running");
  usePoll(refresh, 5000, running);
  useRefocus(() => refresh().catch(() => {}));
  const loaded = !!data;
  useEffect(() => {
    if (loaded) registerPush();
  }, [loaded]);

  if (error && !data) return <ErrorView error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen footer={<Dock box={box} />}>
        <HomeBar me={data.me} running={running} />
        <Bento me={data.me} jobs={data.jobs} onCompose={() => box.current?.focus()} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

function HomeBar({ me, running }: { me: Me; running: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: 8 }}>
      <IconBtn name="person" label="ตั้งค่า" onPress={() => router.push("/settings" as Href)} />
      <Press onPress={() => router.push("/history" as Href)} role="link" label="งานของฉัน"
        style={[{ flexDirection: "row", alignItems: "center", gap: 8, height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: c.surf }, lift(c)]}>
        <Pulse on={running} />
        <T font="mitr-600" size={15} numberOfLines={1}>งานของฉัน</T>
      </Press>
      <Press onPress={() => router.push("/wallet" as Href)} role="link" label={`เครดิต ${baht(me.credit)}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: c.yel }}>
        <Icon name="wallet" size={18} color="#0B1B4D" />
        <T font="mitr-600" size={15} color="#0B1B4D">{baht(me.credit)}</T>
      </Press>
    </View>
  );
}

// The dot in "งานของฉัน": green when idle, blue with a breathing ring while a job runs (.jobs-pill .dot.on).
function Pulse({ on }: { on: boolean }) {
  const c = useColors();
  const motion = useMotion();
  const k = useSharedValue(1);
  useEffect(() => {
    k.value = on && motion ? withRepeat(withTiming(1.3, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true) : withTiming(1);
  }, [on, motion, k]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: k.value }] }));
  return (
    <View accessible={false} style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[{ position: "absolute", width: 20, height: 20, borderRadius: 10, backgroundColor: on ? c.soft : c.gsoft }, ring]} />
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: on ? c.blue : c.gtxt }} />
    </View>
  );
}

// The docked order box (.dock): it grows with the text up to 132px; a template fills it and selects the first blank.
function Dock({ box }: { box: RefObject<ComponentRef<typeof TextInput> | null> }) {
  const c = useColors();
  const toast = useToast();
  const motion = useMotion();
  const insets = useSafeAreaInsets();
  const { draft, setDraft, prefs } = usePrefs();
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<{ start: number; end: number } | undefined>();

  const send = async () => {
    const text = draft.trim();
    if (!text) {
      box.current?.focus();
      return toast("พิมพ์คำถาม หรืองานที่อยากให้ทำก่อน");
    }
    if (busy) return;
    setBusy(true);
    try {
      const r = await api("POST", "/api/talk", { text });
      if (!r.ok) return toast(talkRefused(r));
      setDraft("");
      router.push((r.data.job ? `/quote/${r.data.job.id}` : "/talk") as Href);
    } catch (err) {
      const m = failMessage(err);
      if (m) toast(m);
    } finally {
      setBusy(false);
    }
  };
  const template = (text: string) => {
    setDraft(text);
    box.current?.focus();
    const at = text.indexOf("[");
    if (at >= 0) setTimeout(() => setSel({ start: at, end: text.indexOf("]", at) + 1 }), 60); // after focus puts the caret at the end
  };

  return (
    <Animated.View entering={motion ? SlideInDown.springify().damping(18) : undefined}
      style={{ gap: 10, paddingTop: 8, paddingHorizontal: 16, paddingBottom: Math.max(20, insets.bottom), borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: c.surf, borderTopWidth: 8, borderColor: c.cor,
        shadowColor: "#0B1B4D", shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 8 }}>
      <View accessible={false} style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.dash, marginBottom: 2 }} />
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <TextInput ref={box} value={draft} onChangeText={setDraft} multiline maxLength={1000} placeholder="อยากให้ Smith ช่วยอะไร…" placeholderTextColor={c.ph}
          accessibilityLabel="พิมพ์งานที่อยากให้ทำ" selection={sel}
          onSelectionChange={(e) => { if (sel && (e.nativeEvent.selection.start !== sel.start || e.nativeEvent.selection.end !== sel.end)) setSel(undefined); }}
          style={{ flex: 1, minHeight: 52, maxHeight: 132, paddingTop: 13, paddingBottom: 13, paddingHorizontal: 16, borderRadius: 26, backgroundColor: c.field, color: c.ink, fontSize: 16 * (prefs.big ? 1.18 : 1), fontFamily: "Prompt_400Regular", textAlignVertical: "top" }} />
        <Press onPress={send} label="สั่งงาน" style={{ height: 52, paddingHorizontal: 20, borderRadius: 26, backgroundColor: c.blue, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <T font="mitr-600" size={16} color="#FFFFFF" numberOfLines={1}>{busy ? "กำลังคิด" : "สั่งงาน"}</T>
          {busy && <Dots color="#FFFFFF" />}
        </Press>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" accessibilityLabel="ตัวอย่างงาน"
        style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 2 }}>
        <Chip big icon="help" label="คุยกับ Smith" onPress={() => router.push("/talk" as Href)} />
        {TEMPLATES.map((t) => <Chip key={t.label} big icon={t.icon} tone={t.tone} label={t.label} onPress={() => template(t.text)} />)}
      </ScrollView>
    </Animated.View>
  );
}
