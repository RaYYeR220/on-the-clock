"use client";
// A small time lock for a board row: the brass arc is the share of the embargo still to run.
const INK = "rgb(238 232 220)";
const BRASS = "rgb(184 137 46)";
const IDLE = "rgb(111 104 93)";
const R = 20;
const C = 2 * Math.PI * R;
const TICKS = Array.from({ length: 24 }, (_, i) => i * 15);

export type DialTone = "live" | "out" | "idle";

export function DialLock({ fraction, tone, size = 56 }: { fraction: number; tone: DialTone; size?: number }) {
  const f = Math.min(1, Math.max(0, fraction));
  const a = (f * 360 * Math.PI) / 180;
  const lit = tone === "idle" ? IDLE : BRASS;
  return (
    <svg viewBox="-32 -32 64 64" width={size} height={size} aria-hidden="true" style={{ overflow: "visible", flex: "none" }}>
      <circle r={30.5} fill="rgb(18 17 16)" stroke={INK} strokeOpacity={0.16} />
      {TICKS.map((d) => (
        <line key={d} transform={`rotate(${d})`} x1={0} y1={-28} x2={0} y2={d % 90 === 0 ? -25 : -26.5} stroke={INK} strokeOpacity={d % 90 === 0 ? 0.5 : 0.2} strokeWidth={d % 90 === 0 ? 1.1 : 0.8} />
      ))}
      <circle r={R} fill="none" stroke="rgb(58 54 49)" strokeWidth={3.5} />
      {f > 0 && (
        <circle
          r={R}
          fill="none"
          stroke={BRASS}
          strokeWidth={3.5}
          strokeDasharray={`${f * C} ${C}`}
          transform="rotate(-90)"
          style={{ transition: "stroke-dasharray 0.9s linear" }}
        />
      )}
      {tone === "out" && <circle r={13} fill="none" stroke={BRASS} strokeOpacity={0.55} strokeDasharray="2 3" />}
      <line x1={0} y1={0} x2={Math.sin(a) * 14} y2={-Math.cos(a) * 14} stroke={lit} strokeWidth={1.6} strokeLinecap="round" />
      <circle r={2.6} fill={lit} />
    </svg>
  );
}
