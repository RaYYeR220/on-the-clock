"use client";
import type { CaseView, TimelineItem } from "on-the-clock-sdk";
import { Hash } from "@/components/Hash";
import { blocks } from "@/components/CaseText";
import s from "./case.module.css";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function said(r: TimelineItem): { text: string; tone: "ok" | "bad" | "plain" } {
  if (r.verdict === "premature") return { text: `published a share before the deadline, block ${blocks(r.block)}: not counted`, tone: "bad" };
  if (r.verdict === "ignored") return { text: `receipt ignored: ${r.reason ?? "not counted"}`, tone: "bad" };
  if (r.outcome === "lapsed") return { text: `released its share at block ${blocks(r.block)}`, tone: "ok" };
  if (r.outcome === "withdrawn") return { text: `saw the clock stopped early, block ${blocks(r.block)}`, tone: "plain" };
  return { text: `recorded an early disclosure, block ${blocks(r.block)}`, tone: "plain" };
}

export function Watchers({ view }: { view: CaseView }) {
  const receipts = view.timeline.filter((t) => t.kind === "receipt");
  const { valid, foreign, conflicting } = view.receipts;

  return (
    <section className="panel" aria-labelledby="watchers-h">
      <div className="panel-head">
        <h2 id="watchers-h">Watchers</h2>
        <span className="tag">
          {view.k} of {view.n}
        </span>
      </div>
      <div className={s.pips} role="img" aria-label={`${valid} of ${view.k} needed shares published`}>
        {view.watchers.map((w, i) => (
          <span key={`${w}-${i}`} className={`${s.pip} ${i < valid ? s.pipOn : ""} ${i < view.k ? s.pipNeed : ""}`} />
        ))}
        <span className={s.pipText}>
          <span className="mono">{valid}</span> of {view.k} needed shares published
        </span>
      </div>
      <ul className={s.wlist}>
        {view.watchers.map((w, i) => {
          const mine = receipts.filter((r) => same(r.by, w));
          return (
            <li key={`${w}-${i}`}>
              <p className={s.whead}>
                <span className={s.wname}>watcher {i + 1}</span>
                <Hash value={w} kind="address" />
              </p>
              {mine.length ? (
                mine.map((r) => {
                  const x = said(r);
                  return (
                    <p key={r.key} className={`${s.wsaid} ${s[x.tone]}`}>
                      {x.tone === "ok" ? "✓ " : x.tone === "bad" ? "! " : ""}
                      {x.text}
                    </p>
                  );
                })
              ) : (
                <p className={`${s.wsaid} muted`}>{view.clock.live ? "waiting for the deadline" : "no receipt yet"}</p>
              )}
            </li>
          );
        })}
      </ul>
      {conflicting.length > 0 && (
        <p className={`${s.wnote} ${s.bad}`}>
          {conflicting.length === 1 ? "One watcher" : `${conflicting.length} watchers`} released a share and also recorded a withdrawal. Released shares
          are never outvoted.
        </p>
      )}
      {foreign.length > 0 && (
        <div className={s.foreign}>
          <p className={s.bad}>
            Receipts from {foreign.length === 1 ? "an address" : `${foreign.length} addresses`} outside this case’s watcher set, ignored:
          </p>
          <ul>
            {foreign.map((a, i) => (
              <li key={`${a}-${i}`}>
                <Hash value={a} kind="address" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
