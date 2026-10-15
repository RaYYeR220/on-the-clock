"use client";
import { useEffect } from "react";
import { BLOCK_SECONDS, SEVERITY, type Severity } from "on-the-clock-sdk";
import { useCase, useSecondsUntil, human } from "@/lib/hooks";
import { ErrorNote, Receipts, TxRow } from "./DemoParts";
import { Hash } from "./Hash";
import s from "./DemoWatch.module.css";

type Live = ReturnType<typeof useCase>;

/** The deadline step: what the record shows while the clock runs, the receipts as watchers publish, and the unsealing. */
export function DemoWatch({ live, head, at, onRevealed, done }: { live: Live; head: bigint | null; at: number; onRevealed: () => void; done: boolean }) {
  const { bundle, reveal, error, reload } = live;
  const v = bundle?.view;
  const secs = useSecondsUntil(v?.clock.expiresAt, head, at);
  const unsealed = !!v && (v.status === "revealed" || v.status === "disclosed" || (v.status === "revealable" && !!reveal?.advisory));

  useEffect(() => {
    if (unsealed && !done) onRevealed();
  }, [unsealed, done, onRevealed]);

  if (!v) return error ? <ErrorNote error={{ message: error }} onRetry={() => void reload()} retryLabel="Read it again" /> : <p className="note">Reading the case from Arkiv…</p>;

  const receipts = v.timeline.filter((t) => t.kind === "receipt");
  const valid = v.receipts.valid;
  const lapsed = !v.clock.live;
  const lateBy = lapsed && secs === 0 ? (head !== null ? Number(head - v.effectiveExpiry) * BLOCK_SECONDS : 0) : 0;

  return (
    <div className={s.watch}>
      {!lapsed ? (
        <ul className={s.facts}>
          <li>
            <span>custodian</span>
            <span>
              the researcher, <Hash value={v.custodian} kind="address" />
            </span>
          </li>
          <li>
            <span>vendor acknowledged</span>
            <span>{v.ackedAt !== undefined ? <span className="tag verd">verified · block {v.ackedAt.toString()}</span> : <span className="muted">not yet</span>}</span>
          </li>
          <li>
            <span>extensions</span>
            <span className="mono">
              {v.extensions.requested} asked · {v.extensions.granted} granted · +{v.extensions.seconds} s
            </span>
          </li>
          <li>
            <span>time left</span>
            <span className="mono">{secs === 0 ? "lapsing now…" : human(secs)}</span>
          </li>
        </ul>
      ) : (
        <div className={s.receiptsBox}>
          <div className={s.receiptsHead}>
            <span>Receipts on Arkiv</span>
            <span className="mono">
              {Math.min(valid, v.k)} of {v.k} shares needed
            </span>
          </div>
          {receipts.length === 0 ? (
            <p className="note">
              <i className="lamp blink-b" style={{ marginRight: 8 }} />
              The clock is gone. Waiting for the watchers to prove it lapsed and publish their shares…
              {lateBy > 90 && " This is taking longer than usual. The shares stay escrowed for seven days, so the case stays sealed until two watchers release it."}
            </p>
          ) : (
            <ul className={s.receiptList}>
              {receipts.map((r) => (
                <li key={r.key} className={s.receiptRow}>
                  <span className="mono">{r.by.slice(0, 8)}…</span>
                  <span className={`tag ${r.verdict === "verified" ? "verd" : "rust"}`}>
                    {r.outcome ?? "receipt"} · {r.verdict}
                  </span>
                  <span className="mono muted">block {r.block.toString()}</span>
                  <Hash value={r.key} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {unsealed && <Unsealed live={live} />}
      {v.status === "withdrawn" && <p className={s.notice}>The clock was deleted before its deadline, so the watchers published nothing. The advisory stays sealed.</p>}
    </div>
  );
}

function Unsealed({ live }: { live: Live }) {
  const v = live.bundle!.view;
  const r = live.reveal;
  const name = v.vendor?.name ?? r?.bundle?.name ?? "unknown vendor";
  const a = r?.advisory;
  return (
    <div className={s.unseal}>
      <div>
        <span className={`stamp brass thunk ${s.unsealStamp}`}>unsealed</span>
      </div>
      <p className={s.unsealKicker}>The vendor was</p>
      <h3 className={s.vendorName}>
        <span>{name}</span>
        <i className={s.nameBar} aria-hidden="true" />
      </h3>
      <p className={s.attrib}>
        {v.attribution === "verified" ? (
          <span className="tag verd">attribution verified</span>
        ) : v.attribution === "mismatch" ? (
          <span className="tag rust">attribution mismatch</span>
        ) : (
          <span className="tag">attribution unchecked</span>
        )}
        <span className="note">
          {v.attribution === "verified"
            ? "The named inbox was created by this vendor and carries the keys the case was addressed to, and the responder that acknowledged derives from them."
            : "The named inbox could not be checked against the keys the case was sent to."}
        </span>
      </p>
      {a && (
        <div className={s.advisory}>
          <p className={s.advMeta}>
            <span className="tag brass">{SEVERITY[a.severity as Severity] ?? a.severity}</span>
            {a.cwe && <span className="tag">{a.cwe}</span>}
            <span className="mono muted">{a.component}</span>
          </p>
          <h4>{a.title}</h4>
          <p>{a.summary}</p>
          <p className="note">credited to {a.researcher}</p>
        </div>
      )}
      <Receipts>
        <TxRow label="reveal entity" value={v.reveal?.key} kind="entity" />
        {r?.key && (
          <div className={s.factLine}>
            advisory key <span className="mono">{r.key.slice(0, 18)}…</span> rebuilt from {v.shares.length} published shares
          </div>
        )}
      </Receipts>
    </div>
  );
}
