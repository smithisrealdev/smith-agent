// Credit (public/app.js wallet()), with credit packs bought through the App Store / Google Play.
// Store rule: nothing here may name or point to PromptPay; LINE and the web app keep that way to top up.
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { router, type Href } from "expo-router";
import { useIAP, isUserCancelledError, type Purchase } from "expo-iap";
import { Card, Col, Icon, Item, List, Money, Muted, Note, NoteText, Press, Row, Screen, Sect, T, Tile, TopBar, useColors, useToast, Enter } from "@/ui/kit";
import { Mascot } from "@/ui/Mascot";
import { Loading, ErrorView } from "@/ui/states";
import { api, type Job, type Me, type Pack } from "@/lib/api";
import { useScreen, failMessage } from "@/lib/load";
import { baht, kindOf, when } from "@/lib/format";

type Entry = { amount: number; kind: string; created_at: string; title: string | null };
const KIND: Record<string, string> = { start: "เครดิตเริ่มต้น", grant: "ทีมงานเติมเครดิต", topup: "เติมเครดิต", purchase: "ซื้อเครดิตในแอป", release: "คืนเครดิต งานไม่สำเร็จ", refund: "คืนเงิน" };

export default function Wallet() {
  const toast = useToast();
  const { data, error, reload } = useScreen(async () => {
    const [ledger, me, list] = await Promise.all([api<{ credit: number; entries: Entry[] }>("GET", "/api/ledger"), api<Me>("GET", "/api/me"), api<{ jobs: Job[] }>("GET", "/api/jobs")]);
    return { ...ledger.data, me: me.data, jobs: list.data.jobs || [] };
  });
  const [buying, setBuying] = useState<string | null>(null);

  // The store hands back a purchase; the server checks it with Apple/Google before adding credit. Only then is it
  // finished (consumed), so a purchase the server could not check is offered again on the next launch.
  const iap = useIAP({
    onPurchaseSuccess: async (p: Purchase) => {
      try {
        const r = await api<{ added: number; credit: number }>("POST", "/api/purchase", { platform: Platform.OS, productId: p.productId, receipt: p.purchaseToken });
        if (r.ok) {
          await iap.finishTransaction({ purchase: p, isConsumable: true });
          if (r.data.added) toast(`เติมเครดิต ${baht(r.data.added)} แล้ว`);
          reload();
        } else toast("ยังตรวจการซื้อไม่ผ่าน ไม่ต้องซื้อซ้ำ ระบบจะลองใหม่เมื่อเปิดแอปครั้งถัดไป");
      } catch (err) {
        const m = failMessage(err);
        if (m) toast(m);
      } finally {
        setBuying(null);
      }
    },
    onPurchaseError: (err) => {
      setBuying(null);
      if (!isUserCancelledError(err)) toast("ซื้อไม่สำเร็จ ยังไม่ได้ตัดเงิน ลองใหม่อีกครั้ง");
    },
  });
  const packs = data?.me.packs || [];
  useEffect(() => {
    if (iap.connected && packs.length) iap.fetchProducts({ skus: packs.map((p) => p.id), type: "in-app" }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iap.connected, packs.length]);

  if (error) return <ErrorView error={error} retry={reload} />;
  if (!data) return <Loading title="เครดิต" />;
  const { credit, entries = [], me, jobs } = data;
  // A recent quote not started yet: the way back to it after buying credit.
  const waiting = jobs.find((j) => j.status === "quoted" && Date.now() - Date.parse(j.createdAt) < 7 * 86400e3);
  const priceOf = (p: Pack) => iap.products.find((x) => x.id === p.id)?.displayPrice || baht(p.price);
  const buy = async (p: Pack) => {
    if (buying) return;
    setBuying(p.id);
    try {
      await iap.requestPurchase({ request: { apple: { sku: p.id }, google: { skus: [p.id] } }, type: "in-app" });
    } catch (err) {
      setBuying(null);
      if (!isUserCancelledError(err)) toast("ร้านค้ายังไม่พร้อม ลองใหม่อีกครั้ง");
    }
  };

  return (
    <Screen>
      <TopBar title="เครดิต" />
      <Enter>
        <WalletCard credit={credit} perJob={me.prices?.M || 9} />
      </Enter>
      {waiting && (
        <Press onPress={() => router.push(`/quote/${waiting.id}` as Href)} scale={0.98}>
          <Note icon="clock">
            <NoteText>{`งานที่รอเริ่ม: ${waiting.title || waiting.text} · ${baht(waiting.price)}`}</NoteText>
            <NoteText bold tone="blu">กลับไปเริ่ม</NoteText>
          </Note>
        </Press>
      )}
      {packs.length ? (
        <Card>
          <Row><Tile icon="wallet" bare /><Col gap={2} style={{ flex: 1 }}><T font="mitr" size={15}>ซื้อเครดิต</T><Muted small>จ่ายผ่าน {Platform.OS === "ios" ? "App Store" : "Google Play"} เครดิตเข้าทันที</Muted></Col></Row>
          {packs.map((p) => <PackRow key={p.id} pack={p} price={priceOf(p)} busy={buying === p.id} disabled={!iap.connected || (!!buying && buying !== p.id)} onPress={() => buy(p)} />)}
          {!iap.connected && <Muted small>กำลังเชื่อมต่อร้านค้า…</Muted>}
        </Card>
      ) : (
        <Card>
          <Row><Tile icon="wallet" bare /><Col gap={2} style={{ flex: 1 }}><T font="mitr" size={15}>ซื้อเครดิต</T><Muted small>ช่วงทดลองยังซื้อในแอปไม่ได้ ทีมงานเติมให้</Muted></Col></Row>
          <Muted small>ส่งรหัสนี้ให้ทีมงานเพื่อขอเติมเครดิต</Muted>
          <Note icon={null}><T selectable size={12} style={{ fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) }}>{me.id}</T></Note>
        </Card>
      )}
      <Sect>รายการล่าสุด</Sect>
      <List>{entries.length ? entries.map((e, i) => <LedgerRow key={i} e={e} />) : <Item><Muted>ยังไม่มีรายการ</Muted></Item>}</List>
    </Screen>
  );
}

function WalletCard({ credit, perJob }: { credit: number; perJob: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 18, paddingHorizontal: 20, borderRadius: 28, backgroundColor: "#FFC21A" }}>
      <Col gap={2} style={{ flex: 1 }}>
        <T font="prompt-500" color="#0B1B4D">เครดิตคงเหลือ</T>
        <T font="mitr-700" size={48} lh={1.05} color="#0B1B4D" style={{ letterSpacing: -1 }}>{baht(credit)}</T>
        <T font="prompt-600" size={13} color="#0B1B4D">ใช้ได้ราว {Math.floor(credit / perJob)} งาน</T>
      </Col>
      <Mascot pose="small" />
    </View>
  );
}

function PackRow({ pack, price, busy, disabled, onPress }: { pack: Pack; price: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Press onPress={onPress} disabled={disabled || busy} scale={0.97} label={`เครดิต ${baht(pack.credit)} ราคา ${price}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, backgroundColor: c.soft, opacity: disabled ? 0.5 : 1 }}>
      <Icon name="wallet" fill size={22} color={c.link} />
      <T font="mitr-600" size={17} style={{ flex: 1 }}>เครดิต {baht(pack.credit)}</T>
      <View style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.blue }}>
        <T font="mitr-600" size={15} color="#FFFFFF">{busy ? "กำลังซื้อ…" : price}</T>
      </View>
    </Press>
  );
}

function LedgerRow({ e }: { e: Entry }) {
  const plus = e.amount > 0;
  const label = e.kind === "hold" ? e.title || "งาน" : e.title ? `${KIND[e.kind] || e.kind}: ${e.title}` : KIND[e.kind] || e.kind;
  return (
    <Item>
      <Tile icon={e.title ? kindOf(e.title) : "wallet"} tone={plus ? "good" : undefined} bare />
      <Col gap={2} style={{ flex: 1, minWidth: 0 }}>
        <T font="mitr" numberOfLines={2}>{label}</T>
        <Muted small>{when(e.created_at)}</Muted>
      </Col>
      <Money plus={plus}>{`${plus ? "+" : "−"}${baht(Math.abs(e.amount))}`}</Money>
    </Item>
  );
}
