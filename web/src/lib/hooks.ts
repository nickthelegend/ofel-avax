import { useEffect, useRef, useState } from "react";

export interface Live<T> {
  data?: T;
  error?: string;
  loading: boolean;
  refresh: () => void;
}

/** Poll a live read. Errors are shown, never swallowed. */
export function useLive<T>(fn: () => Promise<T>, deps: unknown[], everyMs = 3000): Live<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const v = await fnRef.current();
        if (!alive) return;
        setData(v);
        setError(undefined);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message.split("\n")[0].slice(0, 220));
      } finally {
        if (alive) setLoading(false);
        if (alive && everyMs > 0) timer = setTimeout(run, everyMs);
      }
    };
    setLoading(true);
    run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, everyMs]);
  return { data, error, loading, refresh: () => setTick((t) => t + 1) };
}

export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
