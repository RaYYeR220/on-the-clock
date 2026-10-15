"use client";
import { BLOCK_SECONDS, type CaseBundle, type CaseStatus, type CaseView, type RevealResult } from "on-the-clock-sdk";
import { CaseStamp } from "@/components/CaseStamp";
import { DialVault } from "@/components/DialVault";
import { Hash, short } from "@/components/Hash";
import { STATUS, blocks, duration, isOut, roleOf, sevLabel } from "@/components/CaseText";
import { queryUrl } from "@/lib/arkiv";
import { human, useSecondsUntil } from "@/lib/hooks";
import { Docket, Ignored } from "./Docket";
import { Explorer } from "./Explorer";
import { Reveal } from "./Reveal";
import { Watchers } from "./Watchers";
import s from "./case.module.css";

const LEDE: Record<CaseStatus, (v: CaseView) => string> = {
  sealed: () => "The embargo is running. The vendor has not acknowledged the report.",
  acknowledged: () => "The embargo is running. The vendor has acknowledged the report from the address this case names.",
  fixed: () => "The embargo is running. The vendor says it has shipped a fix; the deadline still arrives on its own.",
  lapsed: (v) => `The clock ran out. Fewer than ${v.k} of the ${v.n} watchers have published a share, so the key cannot be rebuilt yet.`,
  revealable: (v) => `The clock ran out and ${v.receipts.valid} watchers published their shares: anyone can rebuild the advisory key. No reveal is on Arkiv yet.`,
  revealed: () => "The clock ran out and the deadline published itself. The advisory key is on Arkiv and anyone can check it.",
  disclosed: () => "The researcher disclosed early: the clock was stopped and the advisory key published.",
  withdrawn: () => "The clock was stopped before its deadline. Nothing was released.",
};

const SOURCE: Record<CaseView["effectiveExpirySource"], string> = {
  clock: "the live clock’s Entity Expiration",
  "chain-logs": "the clock’s last expiry in its chain logs",
  records: "the case records (the clock’s logs could not be read)",
};

export function CaseFile({ bundle, reveal, head, at, refreshError }: { bundle: CaseBundle; reveal: RevealResult | null; head: bigint | null; at: number; refreshError: string | null }) {
  const v = bundle.view;
  const live = v.clock.live;
  const secs = useSecondsUntil(live ? v.clock.expiresAt : null, head, at);
  const total = Number(v.clock.expiresAt - bundle.caseEntity.createdAt) * BLOCK_SECONDS;
  const fraction = live && secs !== null && total > 0 ? secs / total : 0;
  const st = STATUS[v.status];
  const query = `app = "onclock" && ($key = ${v.key} || case = ${v.key})`;
  const returned = 1 + bundle.related.length + (bundle.clock ? 1 : 0);
  const decoys = bundle.related.filter((e) => e.kind === "clock" || (e.kind === "trigger" && e.creator.toLowerCase() !== v.researcher.toLowerCase()));

  const flags = [
    v.unrecordedExtension && {
      k: "unrecorded",
      t: "The clock runs later than any recorded grant explains.",
      d: `Its Entity Expiration is block ${blocks(v.clock.expiresAt)}, but the verified grants only support block ${blocks(v.expectedExpiry)}. The clock was extended without a grant on record.`,
    },
    v.unexecutedGrants.length > 0 && {
      k: "unexecuted",
      t: `${v.unexecutedGrants.length === 1 ? "A grant claims" : `${v.unexecutedGrants.length} grants claim`} a deadline the chain never applied.`,
      d: "The record says more time was granted, but the clock was never extended that far. Receipts are judged against what the chain did.",
      keys: v.unexecutedGrants,
    },
    v.custodyMismatch && {
      k: "custody",
      t: "The clock’s owner is not the custodian the records point to.",
      d: `On chain the clock belongs to ${short(v.clock.owner ?? "")}; the handoff records end at ${short(v.custodian)}.`,
    },
    v.revealedEarly && {
      k: "early",
      t: "The key was published by watchers before the deadline.",
      d: `A watcher-side reveal landed before block ${blocks(v.effectiveExpiry)}: evidence that ${v.k} watchers released their shares early.`,
    },
  ].filter((f): f is { k: string; t: string; d: string; keys?: `0x${string}`[] } => !!f);

  return (
    <main className="page">
      <header className={s.top}>
        <p className="eyebrow">
          <i />
          Case file · severity {sevLabel(v.sev)}
        </p>
        <div className={s.titleRow}>
          <h1 className="h-page">Case {short(v.key)}</h1>
          <CaseStamp tone={st.tone} size="large" thunk>
            {st.label}
          </CaseStamp>
        </div>
        <p className={s.fullkey}>
          <Hash value={v.key} full />
        </p>
        <p className="lede">{LEDE[v.status](v)}</p>
        {refreshError && (
          <p className={`note ${s.stale}`} role="status">
            The last refresh failed ({refreshError}). This is the state as last read from Arkiv.
          </p>
        )}
      </header>

      <section className={s.deadline} aria-labelledby="deadline-h">
        <DialVault fraction={fraction} head={head} tone={live ? "live" : isOut(v.status) ? "out" : "idle"}>
          {live ? (
            <>
              <span className={s.dk}>{secs === 0 ? "due now" : "time left"}</span>
              <span className={`${s.dcount} mono`} aria-live="off">
                {human(secs)}
              </span>
              <span className={s.dsub}>until block {blocks(v.clock.expiresAt)}</span>
            </>
          ) : (
            <>
              <span className={s.dk}>deadline</span>
              <span className={`${s.dcount} ${s.dpast} display`}>passed</span>
              <span className={s.dsub}>at block {blocks(v.effectiveExpiry)}</span>
            </>
          )}
        </DialVault>

        <div className={s.facts}>
          <h2 id="deadline-h" className={s.h2}>
            The deadline
          </h2>
          <p className="soft" style={{ marginTop: 8 }}>
            {live
              ? `The embargo is the Entity Expiration of one Arkiv entity, the clock. Only whoever holds it can extend it; when it runs out, ${v.k} of ${v.n} watchers publish the key.`
              : "The clock has run out or been removed. What happens next is decided by the watchers’ receipts, judged against the chain’s record of the deadline."}
          </p>
          <dl className={`kv ${s.kv}`}>
            <dt>held by</dt>
            <dd>
              <Hash value={v.custodian} kind="address" /> <span className="muted">· {roleOf(v, v.custodian)}</span>
            </dd>
            <dt>deadline</dt>
            <dd>
              <span className="mono">block {blocks(live ? v.clock.expiresAt : v.effectiveExpiry)}</span>
              <span className={s.why}>from {SOURCE[v.effectiveExpirySource]}</span>
            </dd>
            <dt>filed deadline</dt>
            <dd>
              <span className="mono">block {blocks(v.filedDeadline)}</span>
              <span className={s.why}>sealed in the case file; nothing can move the deadline earlier</span>
            </dd>
            <dt>clock</dt>
            <dd>
              <Hash value={v.clock.key} /> <span className="muted">· {live ? "running" : "gone"}</span>
            </dd>
            {live && v.clock.owner && (
              <>
                <dt>clock owner</dt>
                <dd>
                  <Hash value={v.clock.owner} kind="address" /> <span className="muted">· on chain</span>
                </dd>
              </>
            )}
            <dt>filed</dt>
            <dd>
              <span className="mono">block {blocks(bundle.caseEntity.createdAt)}</span> <span className="muted">by</span>{" "}
              <Hash value={v.researcher} kind="address" />
            </dd>
            <dt>extensions</dt>
            <dd>
              {v.extensions.requested} asked · {v.extensions.granted} granted
              {v.extensions.granted > 0 && <span className="muted"> · {duration(v.extensions.seconds)} in total</span>}
            </dd>
            <dt>acknowledged</dt>
            <dd>{v.ackedAt !== undefined ? <span className="mono">block {blocks(v.ackedAt)}</span> : <span className="muted">not yet</span>}</dd>
            <dt>marked fixed</dt>
            <dd>{v.fixedAt !== undefined ? <span className="mono">block {blocks(v.fixedAt)}</span> : <span className="muted">no</span>}</dd>
            <dt>release</dt>
            <dd>
              any {v.k} of {v.n} watchers · <span className="mono">{v.receipts.valid}</span> share{v.receipts.valid === 1 ? "" : "s"} published
            </dd>
          </dl>
        </div>
      </section>

      {flags.length > 0 && (
        <section className={s.flags} aria-label="Warnings">
          {flags.map((f) => (
            <div key={f.k} className={s.flag} role="note">
              <span className={s.flagMark} aria-hidden="true">
                !
              </span>
              <div>
                <p className={s.flagT}>{f.t}</p>
                <p className={s.flagD}>{f.d}</p>
                {f.keys && (
                  <p className={s.flagD}>
                    {f.keys.map((k) => (
                      <span key={k} style={{ marginRight: 14 }}>
                        <Hash value={k} />
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {(reveal || isOut(v.status)) && <Reveal view={v} reveal={reveal} />}

      <div className={s.split}>
        <Docket view={v} head={head} at={at} />
        <div className={s.side}>
          <Ignored view={v} decoys={decoys} />
          <Watchers view={v} />
        </div>
      </div>

      <Explorer caseKey={v.key} out={isOut(v.status)} />

      <section className={s.verify} aria-labelledby="verify-h">
        <div>
          <p className="eyebrow">
            <i />
            Verify it yourself
          </p>
          <h2 id="verify-h" className={s.h2} style={{ marginTop: 12 }}>
            Rebuild every verdict on this page without this site.
          </h2>
          <p className="soft" style={{ marginTop: 10, maxWidth: 520 }}>
            One query returns the case file and every Arkiv entity that points at it ({returned} right now). The CLI runs it against the public
            RPC and recomputes the same verdicts from who wrote each one.
          </p>
        </div>
        <div className="stack">
          <code className="code">npx on-the-clock verify {v.key}</code>
          <code className="code">{query}</code>
          <a className="link" href={queryUrl(query)} target="_blank" rel="noreferrer" style={{ justifySelf: "start" }}>
            Run this query in the Data Explorer
          </a>
        </div>
      </section>
    </main>
  );
}
