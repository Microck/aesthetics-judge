// Small one-shot motion pieces, adapted from:
// - TextScramble, SlidingNumber: motion-primitives.com
// - BlurFade: magicui.design
// All run once per change and stop; nothing loops or repaints while idle.
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import { barHeight } from "../lib/scores";

export const SPRING_EASE = [0.175, 0.885, 0.32, 1.1] as const;
const GLYPHS = "abcdefghijklmnopqrstuvwxyz0123456789";

// Resolves random glyphs into `text` left to right, like a decoder locking on.
export function TextScramble({ text, duration = 600, className }: { text: string; duration?: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(text);

  // Timer-driven animation is real synchronization with time, so an effect fits.
  useEffect(() => {
    if (reduced) return setShown(text);
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      const progress = Math.min(1, (performance.now() - start) / duration);
      const locked = Math.floor(progress * text.length);
      setShown(
        text
          .split("")
          .map((char, i) => (i < locked || char === " " ? char : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
          .join(""),
      );
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, duration, reduced]);

  return (
    <span className={className} aria-label={text}>
      <span aria-hidden>{shown}</span>
    </span>
  );
}

// Each digit is a 0-9 column that springs to its value, so the score "rolls" in.
export function SlidingNumber({ value, decimals = 1, className }: { value: number; decimals?: number; className?: string }) {
  const text = value.toFixed(decimals);
  return (
    <span className={`inline-flex tabular-nums ${className ?? ""}`} aria-label={text}>
      {text.split("").map((char, i) =>
        /\d/.test(char) ? (
          // Departure Mono digits advance 0.636em but their ink spans only
          // 0.091-0.545em, so 0.5em cells pull the digits together. The column keeps
          // the full advance and shifts left by half the difference; text wider than
          // its box would otherwise overflow to the right and get clipped.
          <span key={i} aria-hidden className="relative inline-block h-[1em] w-[0.5em] overflow-hidden leading-none">
            <motion.span
              className="absolute -left-[0.068em] top-0 flex w-[0.636em] flex-col"
              initial={{ y: "0em" }}
              animate={{ y: `${-Number(char)}em` }}
              transition={{ type: "spring", stiffness: 140, damping: 20, mass: 0.6, delay: i * 0.05 }}
            >
              {Array.from({ length: 10 }, (_, digit) => (
                <span key={digit} className="block h-[1em] text-center">
                  {digit}
                </span>
              ))}
            </motion.span>
          </span>
        ) : (
          <span key={i} aria-hidden className="inline-flex w-[0.3em] justify-center leading-none">
            {char}
          </span>
        ),
      )}
    </span>
  );
}

export function BlurFade({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.3, delay, ease: SPRING_EASE }}
    >
      {children}
    </motion.div>
  );
}

// Per-window enjoyment, filling in live while the model listens. Same strip as the card.
export function Timeline({ windows, total }: { windows: number[]; total: number }) {
  const peak = windows.length ? Math.max(...windows) : null;
  return (
    <div className="flex h-8 items-end gap-[2px]" role="img" aria-label={`${windows.length} of ${total} ten-second windows scored`}>
      {Array.from({ length: Math.max(total, 1) }, (_, i) => {
        const score = windows[i];
        const height = score === undefined ? 2 : barHeight(score, windows) * 32;
        return (
          <span
            key={i}
            className={`flex-1 transition-[height,background-color] duration-150 ease-[var(--ease-spring)] ${
              score === undefined ? "bg-surface" : score === peak ? "bg-ink" : "bg-muted"
            }`}
            style={{ height }}
          />
        );
      })}
    </div>
  );
}
