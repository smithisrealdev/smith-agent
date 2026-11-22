// Delete the account (app.js deleteScreen() and the "delete" action): type "ลบบัญชี" to unlock the button.
import { useState } from "react";
import { router, type Href } from "expo-router";
import { Btn, Col, Enter, Grow, Note, NoteText, Screen, T, TopBar, Field, useToast } from "@/ui/kit";
import { api, newToken } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { signOutOfLine } from "@/lib/auth";

export default function Delete() {
  const toast = useToast();
  const { setConsent, setDraft } = usePrefs();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    const r = await api("DELETE", "/api/me").catch(() => null); // offline or signed out: same message as a refusal
    if (!r?.ok) {
      setBusy(false);
      return toast("ลบไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
    await newToken();
    setConsent(false);
    setDraft("");
    await signOutOfLine();
    toast("ลบบัญชีและข้อมูลทั้งหมดแล้ว");
    router.dismissAll(); // the settings sheet must not stay open over the welcome slides
    router.replace("/welcome" as Href);
  };
  return (
    <Screen>
      <TopBar title="ลบบัญชี" />
      <Enter>
        <Note tone="bad" icon="trash">
          <Col gap={2}>
            <NoteText tone="bad" bold>ลบแล้วกู้คืนไม่ได้</NoteText>
            <NoteText tone="bad">งาน หลักฐาน และเครดิตที่เหลือจะหายไปทั้งหมด</NoteText>
          </Col>
        </Note>
      </Enter>
      <Enter delay={80}>
        <Col>
          <T size={13} font="prompt-600">พิมพ์ “ลบบัญชี” เพื่อยืนยัน</T>
          <Field value={text} onChangeText={setText} placeholder="ลบบัญชี" accessibilityLabel="พิมพ์ “ลบบัญชี” เพื่อยืนยัน" autoCorrect={false} autoCapitalize="none" autoComplete="off" editable={!busy} />
        </Col>
      </Enter>
      <Grow />
      <Btn title="ลบบัญชีถาวร" kind="danger" disabled={text.trim() !== "ลบบัญชี"} busy={busy && "กำลังลบ"} onPress={remove} />
      <Btn title="ยังไม่ลบ กลับไป" kind="second" onPress={() => (router.canGoBack() ? router.back() : router.replace("/settings" as Href))} />
    </Screen>
  );
}
