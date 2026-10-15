"use client";
import { Fragment } from "react";
import type { CaseView, OtcEntity, TimelineItem } from "on-the-clock-sdk";
import { CaseStamp } from "@/components/CaseStamp";
import { Hash } from "@/components/Hash";
import { blocks, kindWords, roleOf } from "@/components/CaseText";
import { human, useSecondsUntil } from "@/lib/hooks";
import s from "./case.module.css";

const MARK = { verified: "✓", ignored: "✗", premature: "!" } as const;

function detail(t: TimelineItem): string | null {
  if (t.verdict !== "verified") return null;
  switch (t.kind) {
    case "case":
      return "The sealed case file: ciphertext, commitments and public keys only.";
    case "ack":
    case "extreq":
    case "fixed":
      return "Written by the responder address this case names.";
    case "grant":
      return "Written by the clock’s custodian at the time.";
    case "handoff":
      return "Written by the custodian at the time; custody moved with it.";
    case "receipt":
      return t.outcome === "lapsed"
        ? "A watcher saw the clock run out and released its share of the key."
        : t.outcome === "withdrawn"
          ? "A watcher saw the clock removed before its deadline."
          : "A watcher recorded the researcher’s early disclosure.";
    case "reveal":
      return "The published key opens this case and binds its responder to the vendor.";
    default:
      return null;
  }
}

function Entry({ t, view }: { t: TimelineItem; view: CaseView }) {
  const bad = t.verdict !== "verified";
  const d = detail(t);
  return (
    <li className={`${s.entry} ${bad ? s.bad : ""}`}>
      <span className={`${s.vmark} ${s[t.verdict]}`} aria-hidden="true">
        {MARK[t.verdict]}
      </span>
      <div className={s.ebody}>
        <p className={s.etitle}>
          <b>{kindWords(t)}</b>
          {bad ? <span className="tag rust">{t.verdict}</span> : <span className={s.sr}>verified</span>}
          <span className={`${s.eblock} mono`}>block {blocks(t.block)}</span>
        </p>
        <p className={s.emeta}>
          <span>
            by {roleOf(view, t.by)} <Hash value={t.by} kind="address" />
          </span>
          {t.kind === "handoff" && t.to && (
            <span>
              to <Hash value={t.to} kind="address" />
            </span>
          )}
          <span>
            entity <Hash value={t.key} />
          </span>
        </p>
        {t.reason && (
          <p className={s.reason}>
            {t.verdict === "premature" ? "Not counted" : "Ignored"}: {t.reason}.
          </p>
        )}
        {d && <p className={s.edetail}>{d}</p>}
      </div>
    </li>
  );
}

export function Docket({ view, head, at }: { view: CaseView; head: bigint | null; at: number }) {
  const live = view.clock.live;
  const deadline = live ? view.clock.expiresAt : view.effectiveExpiry;
  const secs = useSecondsUntil(live ? deadline : null, head, at);
  const cut = view.timeline.findIndex((t) => t.block >= deadline);
  const mark = (
    <li className={s.deadlineMark}>
      <span className={s.dmLine} aria-hidden="true" />
      <span className="mono">
        deadline · block {blocks(deadline)} · {live ? `in ${human(secs)}` : "passed"}
      </span>
      <span className={s.dmLine} aria-hidden="true" />
    </li>
  );

  return (
    <section className={`panel ${s.docket}`} aria-labelledby="docket-h">
      <div className="panel-head">
        <h2 id="docket-h">Docket</h2>
        <span className="note">{view.timeline.length} entries, oldest first</span>
      </div>
      <p className={s.legend}>
        <span>
          <b className={s.verified}>✓</b> verified
        </span>
        <span>
          <b className={s.ignored}>✗</b> ignored
        </span>
        <span>
          <b className={s.premature}>!</b> premature
        </span>
      </p>
      <ol className={s.entries}>
        {view.timeline.map((t, i) => (
          <Fragment key={t.key}>
            {i === cut && mark}
            <Entry t={t} view={view} />
          </Fragment>
        ))}
        {cut === -1 && mark}
      </ol>
      <div className={s.bound}>
        {view.responderBound ? (
          <p>
            <b>The responder is bound to the vendor.</b> The reveal proved that the responder <Hash value={view.responder} kind="address" /> derives
            from the vendor’s spending key, so every verified vendor act above was written by the vendor.
          </p>
        ) : (
          <p>
            <b>Vendor acts are checked against this case’s responder address,</b> <Hash value={view.responder} kind="address" />, a one-time stealth
            address only the addressed vendor can derive. Until the reveal, a verified acknowledgement means “written by that address”; the reveal
            binds the address to the vendor’s keys.
          </p>
        )}
      </div>
    </section>
  );
}

const REASON: Partial<Record<OtcEntity["kind"], string>> = {
  clock: "not the clock the case file committed to",
  trigger: "escrow not written by the case’s researcher",
};

/** Forgeries and early writes, shown apart so it is plain what was refused and why. */
export function Ignored({ view, decoys }: { view: CaseView; decoys: OtcEntity[] }) {
  const n = view.ignored.length + decoys.length;
  return (
    <section className={`panel ${s.ignoredPanel}`} aria-labelledby="ignored-h">
      <div className="panel-head">
        <h2 id="ignored-h">Ignored writes</h2>
        <span className={`tag ${n ? "rust" : ""}`}>{n}</span>
      </div>
      {n === 0 ? (
        <p className="soft">Nothing ignored. Every write on this case came from the address it had to come from.</p>
      ) : (
        <>
          <p className="soft" style={{ marginBottom: 14 }}>
            Anyone can write to Arkiv. These were written and do not count.
          </p>
          <ul className={s.ilist}>
            {view.ignored.map((t) => (
              <li key={t.key}>
                <p className={s.ihead}>
                  <b>{kindWords(t)}</b>
                  <CaseStamp tone="rust" size="small">
                    {t.verdict}
                  </CaseStamp>
                </p>
                <p className={s.imeta}>
                  by <Hash value={t.by} kind="address" /> · block {blocks(t.block)} · <Hash value={t.key} />
                </p>
                <p className={s.ireason}>{t.reason}</p>
              </li>
            ))}
            {decoys.map((e) => (
              <li key={e.key}>
                <p className={s.ihead}>
                  <b>A {e.kind} for this case</b>
                  <CaseStamp tone="rust" size="small">
                    ignored
                  </CaseStamp>
                </p>
                <p className={s.imeta}>
                  by <Hash value={e.creator} kind="address" /> · block {blocks(e.createdAt)} · <Hash value={e.key} />
                </p>
                <p className={s.ireason}>{REASON[e.kind]}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
