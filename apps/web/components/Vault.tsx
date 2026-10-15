"use client";
// The time-lock door: engraved rings, bolt heads, and a notch ring that advances one notch (3°)
// for every real Tiramisu block, driven by the newHeads subscription.
import { useMemo, useRef } from "react";

const INK = "rgb(238 232 220)";
const BRASS = "rgb(184 137 46)";

export function Vault({ head }: { head: bigint | null }) {
  const base = useRef<bigint | null>(null);
  if (head !== null && base.current === null) base.current = head;
  const turn = head !== null && base.current !== null ? -Number(head - base.current) * 3 : 0;

  const notches = useMemo(
    () =>
      Array.from({ length: 120 }, (_, i) => {
        const major = i % 10 === 0;
        const mid = i % 5 === 0;
        return { i, a: i * 3, major, mid, r2: major ? 424 : mid ? 438 : 446 };
      }),
    [],
  );

  return (
    <div className="vault" aria-hidden="true">
      <div className="door" />
      <svg className="dial" viewBox="-500 -500 1000 1000">
        {[
          [478, BRASS, 0.38],
          [470, INK, 0.12],
          [392, INK, 0.09],
          [384, INK, 0.05],
          [262, INK, 0.05],
        ].map(([r, c, o]) => (
          <circle key={String(r)} r={Number(r)} fill="none" stroke={String(c)} strokeOpacity={Number(o)} vectorEffect="non-scaling-stroke" />
        ))}
        {Array.from({ length: 12 }, (_, i) => {
          const a = ((i * 30 + 15) * Math.PI) / 180;
          return <circle key={i} cx={Math.sin(a) * 488} cy={-Math.cos(a) * 488} r={4.5} fill="none" stroke={INK} strokeOpacity={0.16} />;
        })}
        <g className="notch" style={{ transform: `rotate(${turn}deg)` }}>
          {notches.map((n) => (
            <g key={n.i} transform={`rotate(${n.a})`}>
              <line x1={0} y1={-462} x2={0} y2={-n.r2} stroke={n.major ? BRASS : INK} strokeOpacity={n.major ? 0.9 : n.mid ? 0.42 : 0.22} strokeWidth={n.major ? 2 : 1} />
              {n.major && (
                <text x={0} y={-400} textAnchor="middle" fill={INK} fillOpacity={0.42} fontSize={13} fontFamily="var(--font-jetbrains), monospace" letterSpacing=".06em">
                  {String(n.i).padStart(3, "0")}
                </text>
              )}
            </g>
          ))}
        </g>
        <g className="idx-d" transform="rotate(90)">
          <path d="M-9 -498 L9 -498 L0 -470 Z" fill={BRASS} />
          <line x1={0} y1={-470} x2={0} y2={-414} stroke={BRASS} strokeOpacity={0.55} />
        </g>
        <g className="idx-m">
          <path d="M-9 -498 L9 -498 L0 -470 Z" fill={BRASS} />
          <line x1={0} y1={-470} x2={0} y2={-414} stroke={BRASS} strokeOpacity={0.55} />
        </g>
        <text className="idx-d" x={512} y={5} fill={BRASS} fontSize={12} fontFamily="var(--font-jetbrains), monospace" letterSpacing=".12em">
          NOW
        </text>
      </svg>
    </div>
  );
}

/** A watcher's movement window: a 72-hour dial whose hand shows the hours left on a case. */
export function Movement({ hoursLeft, alive, label, blink = "blink-a" }: { hoursLeft: number | null; alive: boolean; label: string; blink?: string }) {
  const ticks = useMemo(() => Array.from({ length: 24 }, (_, j) => j * 3), []);
  const angle = hoursLeft === null ? 0 : ((Math.min(hoursLeft, 72) / 72) * 360) % 360;
  return (
    <div className="mv">
      <svg viewBox="-36 -36 72 72">
        <circle r={33} fill="rgb(18 17 16)" stroke={INK} strokeOpacity={0.16} />
        <circle r={29.5} fill="none" stroke={BRASS} strokeOpacity={alive ? 0.3 : 0.08} />
        {ticks.map((h) => (
          <g key={h} transform={`rotate(${(h / 72) * 360})`}>
            <line x1={0} y1={-28} x2={0} y2={h % 12 === 0 ? -22 : -25.5} stroke={INK} strokeOpacity={h % 12 === 0 ? 0.55 : 0.25} strokeWidth={h % 12 === 0 ? 1.2 : 0.8} />
          </g>
        ))}
        <text x={0} y={-12} textAnchor="middle" fill={INK} fillOpacity={0.35} fontSize={6.5} fontFamily="var(--font-jetbrains), monospace">
          72H
        </text>
        <g className="hand" style={{ transform: `rotate(${angle}deg)` }}>
          <line x1={0} y1={5} x2={0} y2={-24} stroke={alive ? BRASS : "rgb(111 104 93)"} strokeWidth={1.6} strokeLinecap="round" />
        </g>
        <circle r={2.6} fill={alive ? BRASS : "rgb(111 104 93)"} />
      </svg>
      <span>
        <i className={`lamp ${alive ? blink : "off"}`} />
        {label}
      </span>
    </div>
  );
}
