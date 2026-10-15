"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { InboxCase as Match, StealthKeys } from "on-the-clock-sdk";
import { vendorAct, type VendorAct } from "on-the-clock-sdk";
import { useCase } from "@/lib/hooks";
import { plain, type Plain } from "@/lib/flow-common";
import { responderFor, tryExtendClock, type Attempt } from "@/lib/flow-cases";
import { glm, useBalance } from "@/lib/flow-wallet";
import { ErrorNote, Refusal, TxRow, Working } from "./DemoParts";
import { Hash } from "./Hash";
import { CaseCard, Countdown, ReportView, StatusTag } from "./WalletConsole";
import s from "./InboxCase.module.css";

const UNITS = { minutes: 60, hours: 3600, days: 86_400 } as const;
type Unit = keyof typeof UNITS;
type Action = VendorAct | "extend";

/** One case addressed to this vendor: the decrypted report, and every answer the vendor can give from its one-time responder. */
export function InboxCase({ match, keys, head, at }: { match: Match; keys: StealthKeys; head: bigint | null; at: number }) {
  const caseKey = match.caseEntity.key;
  const { bundle, error: loadError, reload } = useCase(caseKey);
  const responder = useMemo(() => responderFor(keys, match.match), [keys, match.match]);
  const [nonce, setNonce] = useState(0);
  const { balance } = useBalance(responder.account.address, nonce);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<{ action: Action; plain: Plain } | null>(null);
  const [done, setDone] = useState<{ action: Action; tx: string } | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("7");
  const [unit, setUnit] = useState<Unit>("days");

  const v = bundle?.view;
  const live = v?.clock.live ?? true;
  const seconds = Math.round(Number(amount) * UNITS[unit]);
  const report = match.match.report;

  const act = async (action: VendorAct) => {
    setBusy(action);
    setError(null);
    setDone(null);
    try {
      const r = await vendorAct(responder.wallet, caseKey, match.caseEntity.payload, action, {
        ...(action === "extreq" ? { seconds } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setDone({ action, tx: r.txHash });
      setNote("");
      void reload();
    } catch (e) {
      setError({ action, plain: plain(e) });
    } finally {
      setBusy(null);
      setNonce((n) => n + 1);
    }
  };

  const tryExtend = async () => {
    setBusy("extend");
    setError(null);
    setAttempt(null);
    try {
      setAttempt(await tryExtendClock(responder, match.caseEntity.payload.clock));
    } catch (e) {
      setError({ action: "extend", plain: plain(e) });
    } finally {
      setBusy(null);
      setNonce((n) => n + 1);
    }
  };

  const retry = () => {
    if (!error) return;
    if (error.action === "extend") void tryExtend();
    else void act(error.action);
  };

  return (
    <CaseCard
      title={report.advisory.title}
      sev={report.advisory.severity}
      aside={
        <div className={s.aside}>
          {v ? <StatusTag status={v.status} /> : <span className="tag">reading…</span>}
          {v && <Countdown view={v} head={head} at={at} />}
        </div>
      }
    >
      <dl className={s.kv}>
        <dt>case</dt>
        <dd>
          <Hash value={caseKey} /> · <Link className="ext" href={`/case/${caseKey}`}>case file</Link>
        </dd>
        <dt>you answer as</dt>
        <dd>
          <Hash value={responder.account.address} kind="address" /> <span className="muted">· {glm(balance)} from the researcher&apos;s postage</span>
        </dd>
        {v && (
          <>
            <dt>on record</dt>
            <dd className={s.record}>
              {v.ackedAt !== undefined ? <span className="tag verd">acknowledged</span> : <span className="tag">not acknowledged</span>}
              {v.extensions.requested > 0 && (
                <span className="tag">
                  {v.extensions.requested} asked · {v.extensions.granted} granted
                </span>
              )}
              {v.fixedAt !== undefined && <span className="tag verd">fixed</span>}
            </dd>
          </>
        )}
      </dl>
      {loadError && !v && <ErrorNote error={{ message: loadError }} onRetry={() => void reload()} retryLabel="Read it again" />}

      <ReportView report={report} label="The full report (decrypted in this browser, sealed to you only)" />

      <div className={s.actions}>
        <div className={s.answer}>
          <label className="field">
            <span className={s.label}>Note to the researcher (optional, sealed to them)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Received. Triaging now." />
          </label>
          <div className="row">
            {v?.ackedAt === undefined && (
              <button type="button" className="btn small" onClick={() => void act("ack")} disabled={busy !== null}>
                <Working busy={busy === "ack"} idle="Acknowledge" />
              </button>
            )}
            {v?.fixedAt === undefined && (
              <button type="button" className="btn ghost small" onClick={() => void act("fixed")} disabled={busy !== null}>
                <Working busy={busy === "fixed"} idle="Mark fixed" />
              </button>
            )}
          </div>
        </div>

        <div className={s.ask}>
          <span className={s.label}>Ask for more time</span>
          <div className="row" style={{ gap: 8 }}>
            <input className={`input ${s.amount}`} type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
            <select className={`select ${s.unit}`} value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Unit">
              {Object.keys(UNITS).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <button type="button" className="btn ghost small" onClick={() => void act("extreq")} disabled={busy !== null || !live || !(seconds > 0)}>
              <Working busy={busy === "extreq"} idle="Send the request" />
            </button>
          </div>
          <p className="note">A request is a record. Only the researcher can grant it.</p>
        </div>

        <div className={s.cheat}>
          <span className={s.label}>Or take the time yourself</span>
          <button type="button" className={`btn ghost small ${s.cheatBtn}`} onClick={() => void tryExtend()} disabled={busy !== null || !live}>
            <Working busy={busy === "extend"} idle="Try to extend the deadline yourself" working="Sending your extension…" />
          </button>
          <p className="note">Sends extendEntity on the clock from your responder. It costs a little of its gas, and it will not work.</p>
        </div>
      </div>

      {!live && <p className="note" style={{ marginTop: 12 }}>The deadline has passed. Acknowledging or marking it fixed still goes on the record; nothing can move the deadline now.</p>}
      {done && (
        <div style={{ marginTop: 10 }}>
          <TxRow label={done.action === "ack" ? "acknowledged" : done.action === "fixed" ? "marked fixed" : "request sent"} value={done.tx} />
        </div>
      )}
      {attempt && <Refusal attempt={attempt} compact />}
      {error && <ErrorNote error={error.plain} onRetry={retry} />}
    </CaseCard>
  );
}
