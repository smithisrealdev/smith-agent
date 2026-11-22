// PRICE SCREEN (quoteScreen(), quoteView(), rejectedView() and the start/edit actions in public/app.js): the plan,
// the price, and "start". Nothing is charged until start. A job already started goes to its job screen.
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { Bubble, Btn, Center, Enter, Grow, H1, Icon, Muted, Note, NoteText, Pill, Screen, T, TopBar, useColors, useToast } from "@/ui/kit";
import { Mascot } from "@/ui/Mascot";
import { ErrorView, Loading, NotFound } from "@/ui/states";
import { api, type Job } from "@/lib/api";
import { failMessage, useScreen } from "@/lib/load";
import { registerPush } from "@/lib/push";
import { usePrefs } from "@/lib/prefs";
import { baht, NO } from "@/lib/format";
import { CountUp, useMotion, useRefocus } from "@/screens/order/shared";

const NAVY = "#0B1B4D"; // yellow always carries navy text

export default function Quote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, reload } = useScreen(async () => {
    const r = await api<{ job: Job; credit: number }>("GET", `/api/jobs/${id}`);
    return r.ok ? r.data : ("missing" as const);
  }, [id]);
  useRefocus(reload); // back from the wallet: the credit may have changed
  const started = data && data !== "missing" && !["quoted", "rejected"].includes(data.job.status);
  useEffect(() => {
    if (started) router.replace(`/job/${id}` as Href);
  }, [started, id]);

  if (error && !data) return <ErrorView error={error} retry={reload} />;
  if (data === "missing") return <NotFound />;
  if (!data || started) return <Loading title="ตรวจก่อนเริ่ม" />;
  return data.job.status === "rejected" ? <Rejected job={data.job} /> : <QuoteView job={data.job} credit={data.credit} reload={reload} />;
}

// "แก้คำสั่ง": the words go back into the order box at home.
function useEdit(job: Job) {
  const { setDraft } = usePrefs();
  return () => {
    setDraft(job.text || "");
    router.dismissTo("/" as Href);
  };
}

function QuoteView({ job: j, credit, reload }: { job: Job; credit: number; reload: () => Promise<unknown> }) {
  const c = useColors();
  const toast = useToast();
  const motion = useMotion();
  const edit = useEdit(j);
  const [busy, setBusy] = useState(false);
  const short = credit < j.price;

  const start = async () => {
    setBusy(true);
    try {
      const r = await api("POST", `/api/jobs/${j.id}/start`);
      if (!r.ok && r.data.error === "credit") {
        toast("เครดิตไม่พอสำหรับงานนี้");
        return reload();
      }
      if (r.status === 503) {
        toast(NO[503]);
        return reload();
      }
      router.replace(`/job/${j.id}` as Href);
      registerPush({ ask: true }); // the moment a notification is worth it: the result comes later
    } catch (err) {
      const m = failMessage(err);
      if (m) toast(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar title="ตรวจก่อนเริ่ม" />
      <Enter><Bubble text={j.text} /></Enter>
      <Enter delay={60} style={{ borderRadius: 24, backgroundColor: c.soft, padding: 16, gap: 12 }}>
        <T font="mitr-600" size={17}>Smith จะทำแบบนี้</T>
        {j.steps.map((s, i) => (
          <Enter key={i} delay={160 + i * 90} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}><T font="mitr-600" color={c.link}>{i + 1}</T></View>
            <T size={14} lh={1.45} style={{ flex: 1, paddingTop: 3 }}>{s}</T>
          </Enter>
        ))}
        <Muted small>Smith จะไม่จ่ายเงิน ไม่ล็อกอิน และไม่จองแทนคุณ</Muted>
      </Enter>
      <Animated.View entering={motion ? ZoomIn.delay(160 + j.steps.length * 90).springify().damping(11).stiffness(160) : undefined}>
        <View style={{ borderRadius: 24, backgroundColor: c.yel, padding: 16, flexDirection: "row", alignItems: "center", gap: 16, transform: [{ rotate: "-1.2deg" }],
          shadowColor: "#FFC21A", shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 6 }}>
        <View>
          <T font="mitr-600" size={17} color={NAVY}>ราคางานนี้</T>
          <CountUp value={j.price} size={52} color={NAVY} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          {["จ่ายไม่เกินนี้", "ไม่สำเร็จ ไม่คิดเงิน", `ประมาณ ${j.minutes} นาที`].map((t) => (
            <View key={t} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="check" size={16} color={NAVY} />
              <T font="prompt-500" size={13} color={NAVY} style={{ flexShrink: 1 }}>{t}</T>
            </View>
          ))}
        </View>
        </View>
      </Animated.View>
      <Muted small style={{ paddingHorizontal: 4 }}>เครดิตคงเหลือ {baht(credit)}</Muted>
      {short && (
        <Enter>
          <Note tone="warn">
            <NoteText tone="warn">
              เครดิตไม่พอสำหรับงานนี้{" "}
              <NoteText tone="warn" bold accessibilityRole="link" onPress={() => router.push("/wallet" as Href)} style={{ textDecorationLine: "underline" }}>ดูวิธีเติมเครดิต</NoteText>
            </NoteText>
          </Note>
        </Enter>
      )}
      <Grow />
      <Btn title={`เริ่มงาน ${baht(j.price)}`} onPress={start} disabled={short} busy={busy && "กำลังเริ่ม"} />
      <Btn title="แก้คำสั่ง" kind="second" onPress={edit} />
    </Screen>
  );
}

function Rejected({ job: j }: { job: Job }) {
  const edit = useEdit(j);
  return (
    <Screen>
      <TopBar title="ตรวจก่อนเริ่ม" />
      <Enter><Bubble text={j.text} /></Enter>
      <Enter delay={80}>
        <Center style={{ paddingTop: 8 }}>
          <Mascot pose="calm" />
          <H1 size={24}>งานนี้ Smith ยังทำไม่ได้</H1>
          <Muted style={{ textAlign: "center", lineHeight: 22 }}>{j.reason}</Muted>
          <Pill tone="good" icon="check">ไม่คิดเงิน</Pill>
        </Center>
      </Enter>
      <Grow />
      <Btn title="แก้คำสั่ง" onPress={edit} />
      <Btn title="Smith ทำอะไรได้บ้าง" kind="second" onPress={() => router.push("/help" as Href)} />
    </Screen>
  );
}
