"use client";
// The demo's time lock: sixty lit notches that go dark as the embargo runs down, and a brass arc
// for what is left. The same dial reads "lapsed" while the watchers work and "open" once unsealed.
import { useMemo } from "react";
import s from "./DemoDial.module.css";

export type DialState = "idle" | "running" | "lapsed" | "open";

const INK = "rgb(238 232 220)";
const BRASS = "rgb(184 137 46)";
const R_ARC = 156;
const C = 2 * Math.PI * R_ARC;

const clock = (secs: number) => {
  const t = Math.max(0, Math.ceil(secs));
  const m = Math.floor(t / 60);
  return `${String(m).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export function DemoDial({ secondsLeft, totalSeconds, state, caption, sub }: { secondsLeft: number | null; totalSeconds: number; state: DialState; caption?: string; sub?: string }) {
  const frac = state === "idle" ? 1 : state === "running" && secondsLeft !== null ? Math.max(0, Math.min(1, secondsLeft / Math.max(1, totalSeconds))) : 0;
  const ticks = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);
  const lit = Math.ceil(frac * 60);
  const shown = state === "idle" ? clock(totalSeconds) : state === "running" ? clock(secondsLeft ?? totalSeconds) : state === "lapsed" ? "00:00" : "open";
  const label = caption ?? (state === "idle" ? "embargo, not started" : state === "running" ? "until it publishes itself" : state === "lapsed" ? "lapsed · watchers releasing" : "unsealed");

  return (
    <div className={`${s.dial} ${s[state]}`} role="timer" aria-live="off" aria-label={`${shown} ${label}`}>
      <svg viewBox="-220 -220 440 440" aria-hidden="true">
        <circle r={212} fill="rgb(18 17 16 / 0.65)" stroke={BRASS} strokeOpacity={0.32} />
        <circle r={204} fill="none" stroke={INK} strokeOpacity={0.08} />
        {Array.from({ length: 8 }, (_, i) => {
          const a = ((i * 45 + 22.5) * Math.PI) / 180;
          return <circle key={i} cx={Math.sin(a) * 196} cy={-Math.cos(a) * 196} r={3.2} fill="none" stroke={INK} strokeOpacity={0.18} />;
        })}
        {ticks.map((i) => {
          const on = i < lit;
          const major = i % 5 === 0;
          return (
            <line
              key={i}
              transform={`rotate(${i * 6})`}
              x1={0}
              y1={-186}
              x2={0}
              y2={major ? -166 : -174}
              stroke={on ? BRASS : INK}
              strokeOpacity={on ? (major ? 1 : 0.75) : major ? 0.24 : 0.12}
              strokeWidth={major ? 2.4 : 1.4}
              className={s.tick}
            />
          );
        })}
        <circle r={R_ARC} fill="none" stroke={INK} strokeOpacity={0.07} strokeWidth={6} />
        <circle
          r={R_ARC}
          fill="none"
          stroke={BRASS}
          strokeOpacity={state === "open" ? 0.9 : 1}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${(state === "open" ? 1 : frac) * C} ${C}`}
          transform="rotate(-90)"
          className={s.arc}
        />
        <circle r={140} fill="none" stroke={INK} strokeOpacity={0.09} />
        <path d="M-8 -219 L8 -219 L0 -200 Z" fill={BRASS} />
      </svg>
      <div className={s.face}>
        <span className={s.label}>{label}</span>
        <span className={`${s.time} ${state === "open" ? s.timeOpen : ""}`}>{shown}</span>
        {sub && <span className={`${s.sub} mono`}>{sub}</span>}
      </div>
    </div>
  );
}

export type MovementState = "waiting" | "armed" | "checking" | "released" | "withdrawn" | "silent";

const STATE_LABEL: Record<MovementState, string> = {
  waiting: "on duty",
  armed: "holding a share",
  checking: "checking the clock",
  released: "share published",
  withdrawn: "saw a withdrawal",
  silent: "no answer yet",
};

/** One watcher, drawn as a small movement: the hand sweeps while it holds a share and stops at twelve once it has released it. */
export function WatcherMovement({ label, state, blink = 0 }: { label: string; state: MovementState; blink?: number }) {
  const on = state !== "silent";
  return (
    <div className={`${s.mv} ${s[`mv_${state}`]}`}>
      <svg viewBox="-36 -36 72 72" aria-hidden="true">
        <circle r={33} fill="rgb(18 17 16)" stroke={INK} strokeOpacity={0.16} />
        <circle r={29.5} fill="none" stroke={BRASS} strokeOpacity={state === "released" ? 0.85 : on ? 0.3 : 0.08} />
        {Array.from({ length: 12 }, (_, j) => (
          <line key={j} transform={`rotate(${j * 30})`} x1={0} y1={-28} x2={0} y2={j % 3 === 0 ? -22 : -25.5} stroke={INK} strokeOpacity={j % 3 === 0 ? 0.5 : 0.22} strokeWidth={j % 3 === 0 ? 1.2 : 0.8} />
        ))}
        <g className={s.hand} style={{ animationDelay: `${-blink * 1.7}s` }}>
          <line x1={0} y1={5} x2={0} y2={-24} stroke={state === "released" ? BRASS : on ? "rgb(201 160 74)" : "rgb(111 104 93)"} strokeWidth={1.6} strokeLinecap="round" />
        </g>
        <circle r={state === "released" ? 4 : 2.6} fill={on ? BRASS : "rgb(111 104 93)"} />
      </svg>
      <span className={s.mvLabel}>
        <i className={`lamp ${state === "silent" ? "off" : state === "released" ? "" : ["blink-a", "blink-b", "blink-c"][blink % 3]}`} />
        {label}
      </span>
      <span className={s.mvState}>{STATE_LABEL[state]}</span>
    </div>
  );
}
