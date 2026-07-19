"use client";

import { useEffect, useRef, useState } from "react";
import { formatINR } from "@/lib/format";

const DURATION_MS = 700;

/** Counts up to `value` with an ease-out curve; respects reduced motion. */
export function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (
      from === value ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      return;
    }
    let frame: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span className="tabular-nums">{formatINR(display)}</span>;
}
