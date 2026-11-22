// Loading a screen's data the way public/app.js route() does: sign-in and "round full" go to their screens,
// anything else shows the error view with a retry. usePoll refreshes while the screen is in front.
import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect, type Href } from "expo-router";
import { LoginNeeded, RoundFull } from "./api";

export function useScreen<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const alive = useRef(true);
  const run = useCallback(async () => {
    try {
      const d = await load();
      if (alive.current) {
        setData(d);
        setError(null);
      }
      return d;
    } catch (err) {
      if (!alive.current) return null;
      if (err instanceof LoginNeeded) router.replace("/login");
      else if (err instanceof RoundFull) router.replace("/full" as Href);
      else setError(err as Error);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    alive.current = true;
    run();
    return () => {
      alive.current = false;
    };
  }, [run]);
  return { data, error, reload: run, setData };
}

// Call fn every `ms` while this screen is focused and `on` holds. A network blip waits 5 s and tries again.
export function usePoll(fn: () => Promise<unknown>, ms: number, on: boolean) {
  const f = useRef(fn);
  useEffect(() => {
    f.current = fn;
  });
  useFocusEffect(
    useCallback(() => {
      if (!on) return;
      let stop = false;
      let timer: ReturnType<typeof setTimeout>;
      const tick = (wait: number) => {
        timer = setTimeout(async () => {
          let next = ms;
          try {
            await f.current();
          } catch {
            next = 5000;
          }
          if (!stop) tick(next);
        }, wait);
      };
      tick(ms);
      return () => {
        stop = true;
        clearTimeout(timer);
      };
    }, [ms, on]),
  );
}

// What to say when the server turns a tap down, for screens that call api() from a button.
export function failMessage(err: unknown) {
  if (err instanceof LoginNeeded) {
    router.replace("/login");
    return null;
  }
  if (err instanceof RoundFull) {
    router.replace("/full" as Href);
    return null;
  }
  return (err as Error)?.message === "offline" ? "เชื่อมต่อไม่ได้ เช็กอินเทอร์เน็ตแล้วลองใหม่" : "ระบบขัดข้อง ลองใหม่อีกครั้ง";
}
