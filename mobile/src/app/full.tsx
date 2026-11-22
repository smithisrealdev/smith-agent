// The server takes no new accounts in this test round (app.js roundFull).
import { Clouds, Center, Enter, H1, Muted, Screen } from "@/ui/kit";
import { Mascot } from "@/ui/Mascot";

export default function Full() {
  return (
    <Screen>
      <Clouds />
      <Center style={{ paddingTop: 24 }} gap={8}>
        <Enter><Mascot pose="small" /></Enter>
        <Enter delay={80}><H1 size={25}>รอบทดลองเต็มแล้ว</H1></Enter>
        <Enter delay={160}><Muted style={{ textAlign: "center" }}>ขอบคุณที่สนใจครับ ตอนนี้ Smith รับผู้ทดลองครบแล้ว ทีมงานจะแจ้งเมื่อเปิดรอบถัดไป</Muted></Enter>
      </Center>
    </Screen>
  );
}
