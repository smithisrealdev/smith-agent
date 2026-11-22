// The legal screens (app.js legal()): a "draft" note, then each section in a card. terms.tsx uses Legal too.
import { Card, Enter, Note, Screen, Sect, T, TopBar } from "@/ui/kit";
import { PRIVACY, UPDATED, type Sections } from "@/lib/copy";

export function Legal({ title, sections }: { title: string; sections: Sections }) {
  return (
    <Screen>
      <TopBar title={title} />
      <Enter><Note tone="warn">{UPDATED}</Note></Enter>
      {sections.map(([h, items], i) => (
        <Enter key={h} delay={Math.min(i, 6) * 50} style={{ gap: 14 }}>
          <Sect>{h}</Sect>
          <Card>{items.map((t) => <T key={t} lh={1.55}>{t}</T>)}</Card>
        </Enter>
      ))}
    </Screen>
  );
}

export default function Privacy() {
  return <Legal title="นโยบายความเป็นส่วนตัว" sections={PRIVACY} />;
}
