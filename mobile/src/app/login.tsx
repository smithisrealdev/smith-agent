// Sign in (public/app.js login()): LINE everywhere, and Sign in with Apple next to it on iPhone (App Review 4.8).
import { useEffect, useState } from "react";
import { router, type Href } from "expo-router";
import * as AppleAuthentication from "expo-apple-authentication";
import { Btn, Center, Clouds, Grow, H1, LineMark, Muted, Row, Screen, T, useColors, useToast, Enter } from "@/ui/kit";
import { Mascot } from "@/ui/Mascot";
import { appleAvailable, signInWithApple, signInWithLine, type SignIn } from "@/lib/auth";
import { registerPush } from "@/lib/push";
import { failMessage } from "@/lib/load";

export default function Login() {
  const c = useColors();
  const toast = useToast();
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState<"line" | "apple" | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    appleAvailable().then(setApple);
  }, []);

  const after = (r: SignIn) => {
    if (r === "ok") {
      registerPush();
      router.replace("/");
    } else if (r === "full") router.replace("/full" as Href);
    else if (r === "failed") setFailed(true);
  };
  const go = (how: "line" | "apple") => async () => {
    setBusy(how);
    setFailed(false);
    try {
      after(await (how === "line" ? signInWithLine() : signInWithApple()));
    } catch (err) {
      const m = failMessage(err);
      if (m) toast(m);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Clouds />
      <Grow />
      <Enter>
        <Center gap={12}>
          <Mascot pose="idle" size={140} />
          <H1>ยินดีต้อนรับสู่ Smith</H1>
          <Muted size={16} style={{ textAlign: "center", lineHeight: 24 }}>{"เข้าสู่ระบบเพื่อสั่งงาน\nแล้วรับผลเข้าแชท LINE ของคุณ"}</Muted>
        </Center>
      </Enter>
      {failed && <T size={13} color={c.rtxt} style={{ textAlign: "center" }} accessibilityRole="alert">เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง</T>}
      <Grow />
      <Btn kind="line" title="เข้าสู่ระบบด้วย LINE" icon={<LineMark />} busy={busy === "line" && "กำลังไปที่ LINE"} onPress={go("line")} />
      {apple && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={c.dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={28}
          style={{ height: 56, opacity: busy === "apple" ? 0.6 : 1 }}
          onPress={busy ? () => {} : go("apple")}
        />
      )}
      <Row gap={0} style={{ flexWrap: "wrap", justifyContent: "center" }}>
        <Muted small>การเข้าสู่ระบบถือว่าคุณยอมรับ </Muted>
        <T size={13} color={c.link} onPress={() => router.push("/terms" as Href)} accessibilityRole="link">เงื่อนไขการใช้งาน</T>
        <Muted small> และ </Muted>
        <T size={13} color={c.link} onPress={() => router.push("/privacy" as Href)} accessibilityRole="link">นโยบายความเป็นส่วนตัว</T>
      </Row>
    </Screen>
  );
}
