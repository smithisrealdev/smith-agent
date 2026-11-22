// CHAT BEFORE A JOB (talkScreen() and the say action in public/app.js): free answers; a job reply's card opens its
// price screen. New messages rise in and the thread scrolls to the end.
import { useRef, type ComponentRef } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, ScrollView, View } from "react-native";
import Animated, { FadeInUp, LinearTransition } from "react-native-reanimated";
import { router, type Href } from "expo-router";
import { Bubble, Btn, ChatBox, Muted, Screen, T, TopBar, useToast } from "@/ui/kit";
import { ErrorView, Loading } from "@/ui/states";
import { api } from "@/lib/api";
import { failMessage, useScreen } from "@/lib/load";
import { baht, plain } from "@/lib/format";
import { talkRefused, useMotion, useRefocus, type TalkEntry, type TalkJob } from "@/screens/order/shared";

function TalkCard({ c }: { c: TalkJob }) {
  return (
    <View style={{ gap: 8 }}>
      <T font="mitr-600">{c.title}</T>
      {c.status === "quoted" ? <Btn title={`ดูราคา ${baht(c.price)}`} onPress={() => router.push(`/quote/${c.id}` as Href)} />
        : ["cancelled", "rejected"].includes(c.status) ? <Muted small>ยกเลิกแล้ว</Muted>
        : <Btn kind="second" title="ดูงาน" onPress={() => router.push(`/job/${c.id}` as Href)} />}
    </View>
  );
}

export default function Talk() {
  const toast = useToast();
  const motion = useMotion();
  const { data, error, reload, setData } = useScreen(async () => {
    const r = await api<{ talk: TalkEntry[] }>("GET", "/api/talk");
    if (!r.ok) throw new Error(`talk ${r.status}`);
    return r.data.talk;
  });
  useRefocus(reload); // back from a price screen: its card shows the job's new state
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const seen = useRef<number | null>(null); // messages already there when the screen opened don't animate in
  const smooth = useRef(false);

  if (error && !data) return <ErrorView error={error} retry={reload} />;
  if (!data) return <Loading title="คุยกับ Smith" />;
  seen.current ??= data.length;

  const say = async (text: string) => {
    try {
      const r = await api("POST", "/api/talk", { text });
      if (!r.ok) {
        toast(talkRefused(r));
        return false; // a refused message stays in the box, to send again
      }
      setData(r.data.talk);
      if (r.data.job) {
        router.push(`/quote/${r.data.job.id}` as Href);
        return true;
      }
      smooth.current = motion;
      const last = (r.data.talk as TalkEntry[]).at(-1);
      if (last?.role === "smith") AccessibilityInfo.announceForAccessibility(`Smith: ${plain(last.text)}`);
      return true;
    } catch (err) {
      const m = failMessage(err);
      if (m) toast(m);
      return false;
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen scroll={false}>
        <TopBar title="คุยกับ Smith" />
        <ScrollView ref={scroll} style={{ flex: 1, marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4, gap: 8 }}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: smooth.current })}>
          {data.length ? data.map((e, i) => (
            <Animated.View key={`${e.at}-${i}`} entering={motion && i >= (seen.current ?? 0) ? FadeInUp.duration(260).delay(e.role === "smith" ? 120 : 0) : undefined}
              layout={motion ? LinearTransition.springify().damping(18) : undefined}>
              {e.role === "user" ? <Bubble text={e.text} /> : <Bubble smith text={plain(e.text)}>{e.job ? <TalkCard c={e.job} /> : null}</Bubble>}
            </Animated.View>
          )) : <Muted small style={{ paddingHorizontal: 4 }}>ถามเรื่อง Smith หรือเรื่องทั่วไปได้ฟรี งานที่ต้องค้นเว็บ Smith บอกราคาก่อนเริ่ม</Muted>}
        </ScrollView>
        <ChatBox placeholder="พิมพ์ถาม หรือบอกงานที่อยากให้ทำ" max={1000} onSend={say} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
