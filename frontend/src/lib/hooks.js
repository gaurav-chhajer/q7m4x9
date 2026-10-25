import { useEffect, useState } from "react";
import { clamp } from "./format.js";

export function useMedia(query) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** 0..1 progress of scrolling through a tall element (its height minus one viewport). */
export function useScrollProgress(ref, disabled = false) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (disabled) return undefined;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = Math.max(1, r.height - window.innerHeight);
      setP(clamp(-r.top / total, 0, 1));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(calc); };
    calc();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, disabled]);
  return p;
}

const KEY = "windward.settings.v1";
const DEFAULTS = { cutoff: "09:00", confidence: 0.9, demand: "" };

/** cutoff / risk level / demand survive a reload. Storage can be blocked, so everything is guarded. */
export function useSettings() {
  const [s, setS] = useState(() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULTS; }
  });
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }, [s]);
  return [s, (patch) => setS((prev) => ({ ...prev, ...patch }))];
}
