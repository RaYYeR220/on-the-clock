"use client";
import Link from "next/link";
import { BLOCK_SECONDS, type CaseBundle } from "on-the-clock-sdk";
import { CaseStamp } from "@/components/CaseStamp";
import { DialLock } from "@/components/DialLock";
import { Hash, short } from "@/components/Hash";
import { STATUS, blocks, isOut, sevLabel } from "@/components/CaseText";
import { human, useSecondsUntil } from "@/lib/hooks";
import s from "./board.module.css";

export function BoardRow({ bundle, head, at }: { bundle: CaseBundle; head: bigint | null; at: number }) {
  const v = bundle.view;
  const live = v.clock.live;
  const closedEarly = !live && (v.status === "withdrawn" || v.status === "disclosed");
  const secs = useSecondsUntil(live ? v.clock.expiresAt : null, head, at);
  const total = Number(v.clock.expiresAt - bundle.caseEntity.createdAt) * BLOCK_SECONDS;
  const fraction = live && secs !== null && total > 0 ? secs / total : 0;
  const st = STATUS[v.status];
  const named = v.attribution === "verified" && v.vendor;

  return (
    <li className={s.row}>
      <Link className={s.cover} href={`/case/${v.key}`}>
        <span className={s.sr}>Open case {short(v.key)}</span>
      </Link>
      <span className={s.dial}>
        <DialLock fraction={fraction} tone={live ? "live" : isOut(v.status) ? "out" : "idle"} />
      </span>
      <div className={s.id}>
        <span className={s.lift}>
          <Hash value={v.key} />
        </span>
        <span className={s.vendor}>
          <span className={s.k}>vendor</span>{" "}
          {named ? (
            <b>{v.vendor!.name}</b>
          ) : v.attribution === "mismatch" ? (
            <span className="tag rust">name does not match</span>
          ) : (
            <>
              <span className="redact" style={{ width: 72 }} aria-hidden="true" />
              <span className={s.sr}>not revealed</span>
            </>
          )}
        </span>
      </div>
      <span className={s.stamp}>
        <CaseStamp tone={st.tone}>{st.label}</CaseStamp>
      </span>
      <div className={s.time}>
        {live ? (
          <>
            <span className={`${s.count} mono`}>{human(secs)}</span>
            <span className={s.sub}>left · block {blocks(v.clock.expiresAt)}</span>
          </>
        ) : closedEarly ? (
          <>
            <span className={`${s.count} ${s.ended} mono`}>closed early</span>
            <span className={s.sub}>deadline was block {blocks(v.filedDeadline)}</span>
          </>
        ) : (
          <>
            <span className={`${s.count} ${s.ended} mono`}>ended</span>
            <span className={s.sub}>at block {blocks(v.effectiveExpiry)}</span>
          </>
        )}
      </div>
      <dl className={s.meta}>
        <div>
          <dt>severity</dt>
          <dd className={v.sev >= 4 ? "brass" : undefined}>{sevLabel(v.sev)}</dd>
        </div>
        <div>
          <dt>acked</dt>
          <dd>{v.ackedAt !== undefined ? "yes" : "no"}</dd>
        </div>
        <div>
          <dt>extensions</dt>
          <dd>{v.extensions.granted}</dd>
        </div>
        <div>
          <dt>receipts</dt>
          <dd title={closedEarly ? `watchers that saw the clock deleted before its deadline (${v.status})` : "lapse receipts with a share / shares needed"}>
            {closedEarly ? `${v.status === "withdrawn" ? v.receipts.withdrawn : v.receipts.disclosed} ${v.status}` : `${v.receipts.valid}/${v.k}`}
          </dd>
        </div>
      </dl>
    </li>
  );
}
