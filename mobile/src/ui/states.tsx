// Shared whole-screen states: loading (a skeleton shaped like a list), error with retry, a job that is not there.
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, useReducedMotion } from "react-native-reanimated";
import { Mascot } from "./Mascot";
import { Btn, Center, Grow, H1, Muted, Screen, TopBar, useColors } from "./kit";

function Bone({ h, w = "100%", r = 10 }: { h: number; w?: number | `${number}%`; r?: number }) {
  const c = useColors();
  const o = useSharedValue(1);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!reduced) o.value = withRepeat(withTiming(0.45, { duration: 700 }), -1, true);
  }, [o, reduced]);
  const s = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ height: h, width: w, borderRadius: r, backgroundColor: c.field }, s]} />;
}

export function Loading({ title }: { title?: string }) {
  return (
    <Screen>
      <TopBar title={title} />
      <View accessibilityLabel="กำลังโหลด" style={{ gap: 14 }}>
        <Bone h={120} w={120} r={60} />
        <Bone h={28} w="55%" />
        <Bone h={140} r={24} />
        <Bone h={60} r={18} />
        <Bone h={60} r={18} />
      </View>
    </Screen>
  );
}

export function ErrorView({ error, retry }: { error: Error; retry: () => void }) {
  const off = error.message === "offline";
  return (
    <Screen>
      <Grow />
      <Center>
        <Mascot pose="calm" />
        <H1 size={24}>{off ? "เชื่อมต่อไม่ได้" : "ระบบขัดข้อง"}</H1>
        <Muted>{off ? "เช็กอินเทอร์เน็ตแล้วลองใหม่" : "ลองใหม่อีกครั้งในอีกสักครู่"}</Muted>
      </Center>
      <Grow />
      <Btn title="ลองใหม่" onPress={retry} />
    </Screen>
  );
}

export function NotFound() {
  return (
    <Screen>
      <TopBar title="ไม่พบงาน" />
      <Center>
        <Mascot pose="calm" />
        <H1 size={24}>ไม่พบงานนี้</H1>
      </Center>
    </Screen>
  );
}
