// Every job, narrowed by a segmented control (FILTERS / historyList / history and jobRow in public/app.js).
import { useState } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { router, type Href } from "expo-router";
import { Mascot } from "@/ui/Mascot";
import { Btn, Card, Center, Dots, Grow, H1, Item, Money, Muted, Row, Screen, Seg, T, Tile, TopBar, useColors } from "@/ui/kit";
import { ErrorView, Loading } from "@/ui/states";
import { api, type Job } from "@/lib/api";
import { useScreen } from "@/lib/load";
import { STATUS, baht, brandOf, hostOf, kindOf, when } from "@/lib/format";
import { goHome, pictureOf, useMotion } from "@/screens/job/parts";

const FILTERS: [string, (j: Job) => boolean][] = [
  ["ทั้งหมด", () => true],
  ["สำเร็จ", (j) => ["done", "refund_review"].includes(j.status)],
  ["ไม่คิดเงิน", (j) => ["failed", "refunded", "cancelled", "rejected"].includes(j.status)],
];

function JobRow({ j }: { j: Job }) {
  const c = useColors();
  const [label, tone] = STATUS[j.status] || ["", "grey"];
  const href = j.status === "quoted" || j.status === "rejected" ? `/quote/${j.id}` : `/job/${j.id}`;
  const charged = ["done", "refund_review", "running"].includes(j.status);
  const top = j.options?.[0];
  // A finished job shows what it found: the first option's picture, or the logo of the site it came from.
  const done = j.status === "done";
  const photo = done ? pictureOf(top) : "";
  const logo = done && !photo ? brandOf(top) || hostOf(j.sources?.[0]?.url) : "";
  return (
    <Item onPress={() => router.push(href as Href)} label={`${j.title || j.text} ${label}`}>
      <Tile icon={kindOf(`${j.title} ${j.text}`)} tone={tone || undefined} bare iconSize={28} photo={photo || undefined} logo={logo || undefined} />
      <View style={{ flex: 1, gap: 2 }}>
        <T font="mitr" size={15} numberOfLines={2}>{j.title || j.text}</T>
        <Row gap={6}>
          <T size={13} color={c.mut}>{`${when(j.createdAt)} · ${label}`}</T>
          {j.status === "running" && <Dots color={c.mut} />}
        </Row>
      </View>
      {charged && <Money>{baht(j.price)}</Money>}
    </Item>
  );
}

export default function History() {
  const c = useColors();
  const motion = useMotion();
  const [filter, setFilter] = useState(0);
  const { data: jobs, error, reload } = useScreen(async () => (await api<{ jobs: Job[] }>("GET", "/api/jobs")).data.jobs || []);
  if (error) return <ErrorView error={error} retry={reload} />;
  if (!jobs) return <Loading title="งานทั้งหมด" />;

  if (!jobs.length) {
    return (
      <Screen>
        <TopBar title="งานทั้งหมด" />
        <Grow />
        <Center>
          <Mascot pose="small" />
          <H1 size={24}>ยังไม่มีงาน</H1>
          <Muted>งานที่สั่งจะอยู่ตรงนี้ทั้งหมด</Muted>
        </Center>
        <Grow />
        <Btn title="สั่งงานแรก" onPress={goHome} />
      </Screen>
    );
  }

  const shown = jobs.filter(FILTERS[filter][1]);
  const anim = (i: number) => (motion ? { entering: FadeIn.duration(220).delay(Math.min(i, 8) * 30), exiting: FadeOut.duration(140), layout: LinearTransition.springify().damping(18) } : {});
  return (
    <Screen>
      <TopBar title="งานทั้งหมด" />
      <View accessibilityLabel="กรองงาน">
        <Seg items={FILTERS.map(([l]) => l)} value={filter} onChange={setFilter} />
      </View>
      {shown.length ? (
        <Animated.View layout={motion ? LinearTransition : undefined}>
          <Card pad={false} style={{ paddingHorizontal: 16, overflow: "hidden" }}>
            {shown.map((j, i) => (
              <Animated.View key={j.id} {...anim(i)} style={i ? { borderTopWidth: 1.5, borderStyle: "dashed", borderColor: c.dash } : null}>
                <JobRow j={j} />
              </Animated.View>
            ))}
          </Card>
        </Animated.View>
      ) : (
        <Animated.View key={`empty${filter}`} entering={motion ? FadeIn.duration(200) : undefined}>
          <Muted style={{ textAlign: "center", paddingVertical: 24 }}>ไม่มีงานในหมวดนี้</Muted>
        </Animated.View>
      )}
    </Screen>
  );
}
