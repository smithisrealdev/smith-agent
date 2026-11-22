// Asking for a refund (refundScreen / refundView and the reason / refund actions in public/app.js).
import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as Haptics from "expo-haptics";
import { Mascot } from "@/ui/Mascot";
import { Btn, Card, Center, Chip, Enter, Field, Grow, H1, Muted, Note, Pill, Row, Screen, Sect, T, Tile, TopBar, useColors, useToast } from "@/ui/kit";
import { ErrorView, Loading, NotFound } from "@/ui/states";
import { api, type Job } from "@/lib/api";
import { failMessage, useScreen } from "@/lib/load";
import { baht, when } from "@/lib/format";
import { goHome } from "@/screens/job/parts";

const REASONS = ["ราคาไม่ตรงกับหน้าเว็บ", "ลิงก์เปิดไม่ได้", "ไม่ใช่สิ่งที่ขอ", "ข้อมูลไม่ครบ", "อื่นๆ"];
// Same limits as REFUND in src/config.js, for the wording only: the server decides.
const REFUND_AUTO = 3;
const REFUND_PRICE_AUTO = 5;

export default function RefundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const toast = useToast();
  const { data: res, error, reload } = useScreen(() => api<{ job: Job }>("GET", `/api/jobs/${id}`), [id]);
  const [reasons, setReasons] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ result?: string; credit?: number } | null>(null);

  if (error) return <ErrorView error={error} retry={reload} />;
  if (!res) return <Loading title="ขอเงินคืน" />;
  if (!res.ok) return <NotFound />;
  const j = res.data.job;
  const price = reasons.includes(0); // "ราคาไม่ตรงกับหน้าเว็บ" is the first reason: Smith's own mistake
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/job/${j.id}` as Href));

  if (result) {
    const [title, text, mascot] = ({
      refunded: [`คืนเงินแล้ว ${baht(j.price)}`, price ? "ขอโทษที่ราคาไม่ตรง เป็นความผิดของ Smith เครดิตเข้าแล้ว ใช้สั่งงานต่อได้ทันที เราจะเอาไปปรับ Smith" : "เครดิตเข้าแล้ว ใช้สั่งงานต่อได้ทันที ขอบคุณที่บอก เราจะเอาไปปรับ Smith", "done"],
      review: ["ส่งให้ทีมงานตรวจแล้ว", `เดือนนี้ใช้สิทธิ์คืนเงิน${price ? "กรณีราคาไม่ตรง" : ""}อัตโนมัติครบ ${price ? REFUND_PRICE_AUTO : REFUND_AUTO} ครั้งแล้ว ทีมงานจะตรวจให้ภายใน 1 วันทำการ`, "calm"],
      expired: ["เกินเวลาขอคืนเงินแล้ว", "ขอคืนเงินได้ภายใน 24 ชั่วโมงหลังได้ผลงาน", "calm"],
      already: ["ขอคืนเงินงานนี้ไปแล้ว", "ดูสถานะได้ในหน้างาน", "calm"],
      not_charged: ["งานนี้ไม่ได้คิดเงิน", "ไม่ต้องขอคืน", "calm"],
    } as Record<string, [string, string, "done" | "calm"]>)[result.result || ""] || ["ขอคืนเงินไม่ได้", "ลองใหม่อีกครั้ง", "calm"];
    return (
      <Screen>
        <TopBar title="ขอเงินคืน" onBack={back} />
        <Grow />
        <Enter>
          <Center>
            <Mascot pose={mascot} />
            <H1 accessibilityLiveRegion="polite">{title}</H1>
            <Muted style={{ textAlign: "center", lineHeight: 15 * 1.55 }}>{text}</Muted>
            <Pill icon="wallet">{`เครดิตคงเหลือ ${baht(result.credit)}`}</Pill>
          </Center>
        </Enter>
        <Grow />
        <Btn title="กลับหน้าแรก" onPress={goHome} />
      </Screen>
    );
  }

  const toggle = (i: number) => {
    setReasons((old) => (old.includes(i) ? old.filter((x) => x !== i) : [...old, i]));
    setErr(false);
  };
  const send = async () => {
    if (!reasons.length) {
      setErr(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    setBusy(true);
    try {
      const r = await api("POST", `/api/jobs/${j.id}/refund`, { reasons: reasons.map((i) => REASONS[i]), note });
      if (r.data?.result === "refunded") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setResult(r.data || {});
    } catch (e) {
      const m = failMessage(e);
      if (m) toast(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar title="ขอเงินคืน" onBack={back} />
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Tile icon="receipt" />
        <View style={{ flex: 1, gap: 2 }}>
          <T font="mitr" size={15} numberOfLines={2}>{j.title}</T>
          <Muted small>{`จ่ายไป ${baht(j.price)} · เสร็จ${when(j.finishedAt)}`}</Muted>
        </View>
      </Card>
      <View>
        <Sect style={{ marginBottom: 10 }}>ผลไม่ตรงตรงไหน</Sect>
        <Row gap={8} style={{ flexWrap: "wrap" }}>
          {REASONS.map((x, i) => <Chip key={x} label={x} pressed={reasons.includes(i)} onPress={() => toggle(i)} />)}
        </Row>
        {err && <Enter><T accessibilityRole="alert" accessibilityLiveRegion="assertive" size={13} color={c.rtxt} style={{ marginTop: 10, marginHorizontal: 4 }}>เลือกอย่างน้อย 1 ข้อ เพื่อให้เราแก้ได้ถูกจุด</T></Enter>}
      </View>
      {price && <Enter><Note tone="good" icon="check">ราคาไม่ตรงเป็นความผิดของ Smith บอกราคาที่คุณเห็นบนหน้าเว็บในช่องด้านล่าง ทีมงานจะได้ตรวจหน้านั้นซ้ำ</Note></Enter>}
      <View style={{ gap: 8 }}>
        <T font="prompt-600" size={13} style={{ paddingHorizontal: 4 }}>เล่าเพิ่มอีกนิด (ไม่บังคับ)</T>
        <Field value={note} onChangeText={setNote} multiline maxLength={300} placeholder="เช่น ราคาในหน้าจองสูงกว่าที่สรุปไว้" accessibilityLabel="เล่าเพิ่มอีกนิด (ไม่บังคับ)"
          style={{ minHeight: 96, textAlignVertical: "top" }} />
      </View>
      <Note tone="warn" icon="shield">{`คืนเป็นเครดิตทันที เดือนละ ${REFUND_AUTO} ครั้ง (ราคาไม่ตรงกับหน้าเว็บ ${REFUND_PRICE_AUTO} ครั้ง) เกินนั้นทีมงานตรวจให้ภายใน 1 วันทำการ`}</Note>
      <Grow />
      <Btn title={`คืนเงิน ${baht(j.price)}`} busy={busy && "กำลังส่ง"} onPress={send} />
    </Screen>
  );
}
