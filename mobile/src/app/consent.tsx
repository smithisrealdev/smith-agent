// Before the first job: what Smith does with the data, and a yes (app.js consent()).
import { router, type Href } from "expo-router";
import { Btn, Center, Clouds, Col, Enter, Grow, H1, LinkBtn, Note, NoteText, Screen, useColors } from "@/ui/kit";
import { Mascot } from "@/ui/Mascot";
import { usePrefs } from "@/lib/prefs";

export default function Consent() {
  const c = useColors();
  const { setConsent } = usePrefs();
  return (
    <Screen>
      <Clouds />
      <Center style={{ paddingTop: 12 }}>
        <Enter><Mascot pose="small" /></Enter>
        <Enter delay={80}><H1 size={25}>ก่อนเริ่ม ขออนุญาตหน่อยนะ</H1></Enter>
      </Center>
      <Enter delay={160}>
        <Note bg={c.soft}>
          <Col gap={6}>
            <NoteText bold>จำเป็นต่อการใช้งาน</NoteText>
            <NoteText>ใช้คำสั่งและผลงานเพื่อทำงานให้คุณ ไม่ขายข้อมูลให้ใคร และลบบัญชีพร้อมข้อมูลทั้งหมดได้เองในหน้าตั้งค่า</NoteText>
            <NoteText>คำสั่งและหน้าเว็บที่ Smith อ่าน จะส่งไปประมวลผลกับผู้ให้บริการ AI ในต่างประเทศ</NoteText>
          </Col>
        </Note>
      </Enter>
      <Enter delay={240}><Note icon="lock">อย่าพิมพ์รหัสผ่าน เลขบัตร หรือ OTP ลงในคำสั่ง Smith ไม่ต้องใช้ข้อมูลเหล่านี้</Note></Enter>
      <Enter delay={300}><LinkBtn title="อ่านนโยบายความเป็นส่วนตัว" onPress={() => router.push("/privacy" as Href)} /></Enter>
      <Grow />
      <Btn title="ยอมรับและไปต่อ" onPress={() => { setConsent(true); router.replace("/"); }} />
    </Screen>
  );
}
