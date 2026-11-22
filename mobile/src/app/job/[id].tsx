// A started job: running, done, failed or cancelled (jobScreen in public/app.js) and its actions.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Share } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useToast } from "@/ui/kit";
import { ErrorView, Loading, NotFound } from "@/ui/states";
import { api, type Job } from "@/lib/api";
import { failMessage, usePoll, useScreen } from "@/lib/load";
import { NO, shareText } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { RunningView } from "@/screens/job/running";
import { CancelledView, DoneView, FailedView, type Acts } from "@/screens/job/result";
import { goHome } from "@/screens/job/parts";

type Data = { job: Job; credit: number };

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const { setDraft } = usePrefs();
  const { data: res, error, reload, setData } = useScreen(() => api<Data>("GET", `/api/jobs/${id}`), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const watched = useRef(false); // seen running on this screen: when it finishes, the result arrives with a celebration
  const [fresh, setFresh] = useState(false);
  const job = res?.ok ? res.data.job : null;
  const status = job?.status;

  useEffect(() => {
    if (status === "quoted" || status === "rejected") router.replace(`/quote/${id}` as Href);
    if (status === "running") watched.current = true;
    else if (status && watched.current && !fresh) {
      setFresh(true);
      if (status === "done") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [status, id, fresh]);

  // While it runs, refresh in place every 3 s; a failed poll just waits for the next one.
  usePoll(async () => {
    const r = await api<Data>("GET", `/api/jobs/${id}`);
    if (r.ok) setData(r);
  }, 3000, status === "running");

  if (error) return <ErrorView error={error} retry={reload} />;
  if (!res) return <Loading />;
  if (!res.ok || !job) return <NotFound />;
  const credit = res.data.credit;

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      const m = failMessage(err);
      if (m) toast(m);
    } finally {
      setBusy(null);
    }
  };
  const acts: Acts = {
    busy,
    retry: () => {
      setBusy("retry");
      guard(async () => {
        const r = await api("POST", "/api/quote", { text: job.text });
        if (!r.ok) return toast(NO[r.status] || "ระบบขัดข้อง ลองใหม่อีกครั้ง");
        router.push(`/quote/${r.data.job.id}` as Href);
      });
    },
    edit: () => {
      setDraft(job.text || "");
      goHome();
    },
    share: () => {
      Share.share({ message: shareText(job) }).catch(() => {});
    },
    copy: async (code) => {
      try {
        await Clipboard.setStringAsync(code);
        toast(`คัดลอกโค้ด ${code} แล้ว`);
      } catch {
        toast(`โค้ดคือ ${code} กดค้างที่โค้ดเพื่อคัดลอก`);
      }
    },
    ask: async (text) => {
      try {
        const r = await api<Data & { error?: string }>("POST", `/api/jobs/${id}/chat`, { text });
        // a refused question stays in the box, to send again
        if (!r.ok) {
          toast(r.status === 429 ? "ถามได้ไม่เกิน 10 ข้อต่องาน" : r.data?.error === "chat_busy" ? "Smith กำลังตอบคำถามก่อนหน้า รอสักครู่" : NO[r.status] || "ระบบขัดข้อง ลองใหม่อีกครั้ง");
          return false;
        }
        setData((old) => (old ? { ...old, data: { ...old.data, job: r.data.job } } : old));
        AccessibilityInfo.announceForAccessibility(`Smith: ${r.data.job.chat.at(-1)?.text || ""}`);
        return true;
      } catch (err) {
        const m = failMessage(err);
        if (m) toast(m);
        return false;
      }
    },
    // A re-search card: start it, then watch it.
    start: (childId) => {
      setBusy(`start:${childId}`);
      guard(async () => {
        const r = await api("POST", `/api/jobs/${childId}/start`);
        if (!r.ok && r.data?.error === "credit") {
          toast("เครดิตไม่พอสำหรับงานนี้");
          return reload();
        }
        if (r.status === 503) {
          toast(NO[503]);
          return reload();
        }
        router.push(`/job/${childId}` as Href);
      });
    },
  };

  if (job.status === "running") return <RunningView j={job} />;
  if (job.status === "quoted" || job.status === "rejected") return <Loading />;
  if (job.status === "failed") return <FailedView j={job} credit={credit} acts={acts} />;
  if (job.status === "cancelled") return <CancelledView j={job} />;
  return <DoneView j={job} credit={credit} fresh={fresh} acts={acts} />;
}
