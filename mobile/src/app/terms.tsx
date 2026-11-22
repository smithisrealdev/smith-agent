import { TERMS } from "@/lib/copy";
import { Legal } from "./privacy";

export default function Terms() {
  return <Legal title="เงื่อนไขการใช้งาน" sections={TERMS} />;
}
