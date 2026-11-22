// Settings (public/app.js settings()), as a native sheet over home: credit, jobs, help, theme, the three phone
// settings, sign out, delete account.
import { ScrollView, Switch, View } from "react-native";
import { router, type Href } from "expo-router";
import { Btn, Col, Icon, Item, Money, Muted, Press, Seg, T, Tile, useColors, useToast, Sect } from "@/ui/kit";
import { api, newToken, type Me } from "@/lib/api";
import { useScreen, failMessage } from "@/lib/load";
import { usePrefs, type Prefs } from "@/lib/prefs";
import { signOutOfLine } from "@/lib/auth";
import { baht } from "@/lib/format";

const THEMES: [Prefs["theme"], string][] = [["auto", "ตามระบบ"], ["light", "สว่าง"], ["dark", "มืด"]];
const PREFS: [keyof Omit<Prefs, "theme">, string, string][] = [["big", "doc", "ตัวหนังสือใหญ่"], ["motion", "sparkle", "ภาพเคลื่อนไหว"], ["pictures", "image", "รูปสินค้าและโลโก้"]];

export default function Settings() {
  const c = useColors();
  const toast = useToast();
  const { prefs, setPref } = usePrefs();
  const { data: me } = useScreen(async () => (await api<Me>("GET", "/api/me")).data);
  const go = (href: string) => {
    router.back();
    router.push(href as Href);
  };
  const row = (href: string, icon: string, label: string, right?: React.ReactNode, tone?: string) => (
    <Item onPress={() => go(href)} label={label}>
      <Tile icon={icon} tone={tone} />
      <T font="mitr" color={tone === "bad" ? c.rtxt : undefined} style={{ flex: 1 }}>{label}</T>
      {right}
      <Icon name="chev" color={c.mut} />
    </Item>
  );
  const logout = async () => {
    try {
      await api("POST", "/api/logout");
      await newToken(); // a fresh device token: the old one stays unlinked on the server
      await signOutOfLine();
      router.dismissAll();
      router.replace("/login" as Href);
    } catch (err) {
      const m = failMessage(err);
      if (m) toast(m);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.page }} contentContainerStyle={{ padding: 16, paddingTop: 20, gap: 4 }}>
      <Sect style={{ textAlign: "center", paddingBottom: 8 }}>ตั้งค่า</Sect>
      {row("/wallet", "wallet", "เครดิต", me ? <Money>{baht(me.credit)}</Money> : null)}
      {row("/history", "list", "งานทั้งหมด")}
      {row("/help", "help", "ช่วยเหลือและข้อมูลส่วนตัว")}
      <Col gap={6} style={{ paddingVertical: 10 }}>
        <T font="mitr">ธีม</T>
        <Seg items={THEMES.map(([, l]) => l)} value={THEMES.findIndex(([k]) => k === prefs.theme)} onChange={(i) => setPref("theme", THEMES[i][0])} />
      </Col>
      {PREFS.map(([key, icon, label]) => (
        <Item key={key}>
          <Tile icon={icon} />
          <T font="mitr" style={{ flex: 1 }}>{label}</T>
          <Switch value={prefs[key]} onValueChange={(v) => setPref(key, v)} trackColor={{ true: "#1FA855", false: c.off }} accessibilityLabel={label} />
        </Item>
      ))}
      {me && (me.login || me.apple) && (
        <Press onPress={logout} scale={0.98} label="ออกจากระบบ">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60 }}>
            <Tile icon="logout" />
            <T font="mitr" style={{ flex: 1 }}>ออกจากระบบ</T>
          </View>
        </Press>
      )}
      {row("/delete", "trash", "ลบบัญชีและข้อมูลทั้งหมด", null, "bad")}
      {me && <Muted small style={{ textAlign: "center", paddingTop: 6 }}>Smith รุ่นทดลอง · รหัส {me.id.replace(/^(web|apple):/, "").slice(0, 8)}</Muted>}
      <View style={{ height: 12 }} />
      <Btn kind="second" title="ปิด" onPress={() => router.back()} />
    </ScrollView>
  );
}
