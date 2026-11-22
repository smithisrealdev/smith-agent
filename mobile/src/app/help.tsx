// Help (app.js help()): FAQ that opens and closes smoothly, what Smith cannot do, and the legal links.
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing, useReducedMotion } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Card, Col, Enter, Icon, LinkBtn, Note, NoteText, Row, Screen, Sect, T, TopBar, useColors } from "@/ui/kit";
import { usePrefs } from "@/lib/prefs";
import { CANT, FAQ } from "@/lib/copy";

function Faq({ q, a, first }: { q: string; a: string; first: boolean }) {
  const c = useColors();
  const { prefs } = usePrefs();
  const still = useReducedMotion() || !prefs.motion;
  const [open, setOpen] = useState(false);
  const h = useSharedValue(0); // the answer's measured height
  const p = useSharedValue(0); // 0 closed .. 1 open
  useEffect(() => {
    p.value = still ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [open, still, p]);
  const body = useAnimatedStyle(() => ({ height: h.value * p.value, opacity: p.value }));
  const chev = useAnimatedStyle(() => ({ transform: [{ rotate: `${p.value * 180}deg` }] }));
  return (
    <View style={first ? null : { borderTopWidth: 1, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={q}
        onPress={() => { Haptics.selectionAsync().catch(() => {}); setOpen(!open); }}>
        <Row gap={8} style={{ minHeight: 52, justifyContent: "space-between", paddingVertical: 8 }}>
          <T font="prompt-600" size={15} style={{ flex: 1 }}>{q}</T>
          <Animated.View style={chev}><Icon name="chevd" /></Animated.View>
        </Row>
      </Pressable>
      <Animated.View style={[{ overflow: "hidden" }, body]} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"}>
        {/* absolute so it lays out at its full height while the box around it is still closed */}
        <View style={{ position: "absolute", left: 0, right: 0 }} onLayout={(e) => { h.value = e.nativeEvent.layout.height; }}>
          <T size={14} lh={1.55} color={c.mut} style={{ paddingBottom: 14 }}>{a}</T>
        </View>
      </Animated.View>
    </View>
  );
}

export default function Help() {
  const c = useColors();
  return (
    <Screen>
      <TopBar title="ช่วยเหลือ" />
      <Sect>คำถามที่พบบ่อย</Sect>
      <Enter>
        <Card pad={false} style={{ paddingHorizontal: 16 }}>
          {FAQ.map(([q, a], i) => <Faq key={q} q={q} a={a} first={i === 0} />)}
        </Card>
      </Enter>
      <Enter delay={80}>
        <Note tone="bad" icon={null}>
          <Col gap={8}>
            <NoteText tone="bad" bold>Smith ทำอะไรไม่ได้</NoteText>
            {CANT.map((t) => (
              <Row key={t} gap={8} style={{ alignItems: "flex-start" }}>
                <View style={{ marginTop: 1 }}><Icon name="x" color={c.rtxt} /></View>
                <NoteText tone="bad" style={{ flex: 1 }}>{t}</NoteText>
              </Row>
            ))}
          </Col>
        </Note>
      </Enter>
      <Row gap={16} style={{ justifyContent: "center" }}>
        <LinkBtn title="นโยบายความเป็นส่วนตัว" onPress={() => router.push("/privacy" as Href)} />
        <LinkBtn title="เงื่อนไขการใช้งาน" onPress={() => router.push("/terms" as Href)} />
      </Row>
    </Screen>
  );
}
