"use client";
import type { ReactNode } from "react";
import { Hash, short } from "./Hash";
import type { Plain } from "@/lib/flow-common";
import type { Attempt } from "@/lib/flow-cases";
import s from "./DemoParts.module.css";

/** A failure in plain words, with the way forward right next to it. */
export function ErrorNote({ error, onRetry, retryLabel = "Try again", title, children }: { error: Plain; onRetry?: () => void; retryLabel?: string; title?: string; children?: ReactNode }) {
  return (
    <div className={s.error} role="alert">
      <p className={s.errorHead}>
        <span className={s.errorMark} aria-hidden="true">!</span>
        {title ?? (onRetry && /read/i.test(retryLabel) ? "Could not read it." : "That did not go through.")}
      </p>
      <p className={s.errorBody}>{error.message}</p>
      {error.txHash && (
        <p className={s.errorTx}>
          transaction <Hash value={error.txHash} kind="tx" />
        </p>
      )}
      <div className="row" style={{ marginTop: 12, gap: 10 }}>
        {onRetry && (
          <button type="button" className="btn small" onClick={onRetry}>
            {retryLabel}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

export function TxRow({ label, value, kind = "tx" }: { label: string; value: string | null | undefined; kind?: "tx" | "entity" | "address" }) {
  if (!value) return null;
  return (
    <div className={s.txRow}>
      <span>{label}</span>
      <Hash value={value} kind={kind} />
    </div>
  );
}

export function Receipts({ children }: { children: ReactNode }) {
  return <div className={s.receipts}>{children}</div>;
}

export function Spinner() {
  return <span className={s.spinner} aria-hidden="true" />;
}

/** The working label on a button while its transaction is in flight. */
export function Working({ busy, idle, working = "Sending…" }: { busy: boolean; idle: ReactNode; working?: ReactNode }) {
  return busy ? (
    <>
      <Spinner />
      {working}
    </>
  ) : (
    <>{idle}</>
  );
}

/** The vendor's own attempt at moving the deadline, and what the chain said. */
export function Refusal({ attempt, compact = false }: { attempt: Attempt; compact?: boolean }) {
  if (!attempt.refused) {
    return (
      <div className={`${s.refusal} ${compact ? s.compact : ""}`}>
        <span className={`stamp ink thunk ${s.bigStamp}`}>not refused</span>
        <p className={s.refusalBody}>
          The chain accepted the vendor&apos;s extension. That should be impossible: the clock is not the vendor&apos;s. Check the transaction below.
        </p>
        {attempt.txHash && <TxRow label="transaction" value={attempt.txHash} />}
      </div>
    );
  }
  return (
    <div className={`${s.refusal} ${compact ? s.compact : ""}`} role="status">
      <div className={s.stampWrap}>
        <span className={`stamp rust thunk ${s.bigStamp}`}>{attempt.notOwner ? "Refused — not owner" : "Refused — reverted"}</span>
      </div>
      <p className={s.refusalBody}>
        The vendor&apos;s one-time address <b className="mono">{short(attempt.caller)}</b> asked Arkiv to push the deadline out to about 55 hours from now.
        {attempt.owner ? (
          <>
            {" "}
            The clock belongs to <b className="mono">{short(attempt.owner)}</b>, the researcher, so the transaction reverted.
          </>
        ) : (
          " The transaction reverted."
        )}{" "}
        The deadline did not move.
      </p>
      <code className={`code ${s.refusalErr}`}>{attempt.message}</code>
      {attempt.txHash ? (
        <TxRow label="the reverted transaction" value={attempt.txHash} />
      ) : (
        <p className="note">Arkiv rejected it before it was mined, so there is no transaction to link.</p>
      )}
    </div>
  );
}
