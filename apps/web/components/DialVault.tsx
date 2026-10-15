"use client";
// The case's time lock, drawn as the landing's vault door at the scale of one case: the outer notch
// ring turns one notch (3°) per Tiramisu block, the brass arc is the share of the embargo still to run.
import { useId, useMemo, useRef, type ReactNode } from "react";
import type { DialTone } from "./DialLock";
import s from "./DialVault.module.css";

const INK = "rgb(238 232 220)";
const BRASS = "rgb(184 137 46)";
const ARC_R = 206;
const ARC_C = 2 * Math.PI * ARC_R;

export function DialVault({ fraction, head, tone, children }: { fraction: number; head: bigint | null; tone: DialTone; children: ReactNode }) {
  const face = `dial${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const base = useRef<bigint | null>(null);
  if (head !== null && base.current === null) base.current = head;
  const turn = head !== null && base.current !== null ? -Number(head - base.current) * 3 : 0;
  const f = Math.min(1, Math.max(0, fraction));
  const end = (f * 360 * Math.PI) / 180;

  const notches = useMemo(
    () =>
      Array.from({ length: 120 }, (_, i) => {
        const major = i % 10 === 0;
        const mid = i % 5 === 0;
        return { i, a: i * 3, major, mid, r2: major ? 244 : mid ? 250 : 255 };
      }),
    [],
  );
  const grooves = useMemo(() => Array.from({ length: 15 }, (_, i) => 64 + i * 8), []);

  return (
    <div className={s.dial}>
      <svg viewBox="-300 -300 600 600" aria-hidden="true">
        <defs>
          <radialGradient id={face}>
            <stop offset="0%" stopColor="rgb(33 31 28)" />
            <stop offset="62%" stopColor="rgb(30 28 26)" />
            <stop offset="100%" stopColor="rgb(24 23 21)" />
          </radialGradient>
        </defs>
        <circle r={296} fill={`url(#${face})`} />
        {grooves.map((r) => (
          <circle key={r} r={r} fill="none" stroke={INK} strokeOpacity={0.028} />
        ))}
        <circle r={296} fill="none" stroke={BRASS} strokeOpacity={0.38} />
        <circle r={274} fill="none" stroke={INK} strokeOpacity={0.12} />
        {Array.from({ length: 12 }, (_, i) => {
          const a = ((i * 30 + 15) * Math.PI) / 180;
          return <circle key={i} cx={Math.sin(a) * 285} cy={-Math.cos(a) * 285} r={3.5} fill="none" stroke={INK} strokeOpacity={0.18} />;
        })}
        <g className="notch" style={{ transform: `rotate(${turn}deg)` }}>
          {notches.map((n) => (
            <line
              key={n.i}
              transform={`rotate(${n.a})`}
              x1={0}
              y1={-266}
              x2={0}
              y2={-n.r2}
              stroke={n.major ? BRASS : INK}
              strokeOpacity={n.major ? 0.85 : n.mid ? 0.4 : 0.2}
              strokeWidth={n.major ? 2 : 1}
            />
          ))}
        </g>
        <circle r={232} fill="none" stroke={INK} strokeOpacity={0.08} />
        {[0, 90, 180, 270].map((d) => (
          <line key={d} transform={`rotate(${d})`} x1={0} y1={-226} x2={0} y2={-218} stroke={INK} strokeOpacity={0.35} />
        ))}
        <circle r={ARC_R} fill="none" stroke="rgb(42 39 36)" strokeWidth={12} />
        {f > 0 && (
          <>
            <circle
              className={s.arc}
              r={ARC_R}
              fill="none"
              stroke={BRASS}
              strokeWidth={12}
              strokeDasharray={`${f * ARC_C} ${ARC_C}`}
              transform="rotate(-90)"
            />
            <circle cx={Math.sin(end) * ARC_R} cy={-Math.cos(end) * ARC_R} r={9} fill="rgb(18 17 16)" stroke={BRASS} strokeWidth={2} />
          </>
        )}
        {tone === "out" && <circle r={ARC_R} fill="none" stroke={BRASS} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="3 7" />}
        <circle r={186} fill="none" stroke={INK} strokeOpacity={0.1} />
        <circle r={180} fill="none" stroke={INK} strokeOpacity={0.05} />
        <path d="M-10 -300 L10 -300 L0 -276 Z" fill={BRASS} />
      </svg>
      <div className={s.face}>{children}</div>
    </div>
  );
}
