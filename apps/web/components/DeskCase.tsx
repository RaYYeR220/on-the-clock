"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { isAddress, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { discloseEarly, grantExtension, handOff, openForResearcher, verifyRevealKey, withdraw, type CasePayload, type OtcEntity, type Report } from "on-the-clock-sdk";
import { useCase } from "@/lib/hooks";
import { writeClient } from "@/lib/arkiv";
import { duration, loadAdvisoryKey, plain, Plainly, type Plain } from "@/lib/flow-common";
import { eqAddr, pendingRequests, vendorNotes } from "@/lib/flow-cases";
import { ErrorNote, TxRow, Working } from "./DemoParts";
import { Hash } from "./Hash";
import { CaseCard, Countdown, ReportView, StatusTag } from "./WalletConsole";
import s from "./DeskCase.module.css";

const GRANTS = [
  { s: 3600, label: "+1 hour" },
  { s: 86_400, label: "+1 day" },
  { s: 7 * 86_400, label: "+7 days" },
];

type Op = string;

/** One case this researcher filed: its clock, the vendor's answers, and everything only the custodian can do. */
export function DeskCase({ caseEntity, account, selfKey, head, at }: { caseEntity: OtcEntity<CasePayload>; account: PrivateKeyAccount; selfKey: Hex; head: bigint | null; at: number }) {
  const caseKey = caseEntity.key;
  const { bundle, error: loadError, reload } = useCase(caseKey);
  const [busy, setBusy] = useState<Op | null>(null);
  const [error, setError] = useState<{ op: Op; plain: Plain; retry: () => void } | null>(null);
  const [done, setDone] = useState<{ label: string; tx: string } | null>(null);
  const [confirm, setConfirm] = useState<"withdraw" | "disclose" | null>(null);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [k, setK] = useState<Hex | null>(null);

  useEffect(() => {
    setK(loadAdvisoryKey(caseKey));
  }, [caseKey]);

  const report = useMemo<Report | null>(() => {
    try {
      return openForResearcher(caseKey, caseEntity.payload, selfKey);
    } catch {
      return null;
    }
  }, [caseKey, caseEntity.payload, selfKey]);

  const v = bundle?.view;
  const live = !!v?.clock.live;
  const holder = v?.clock.owner ?? null;
  const mine = live && eqAddr(holder, account.address);
  const pending = bundle ? pendingRequests(bundle) : [];
  const notes = bundle ? vendorNotes(bundle, selfKey) : [];
  const toValid = isAddress(to) && !eqAddr(to, account.address);

  const run = async (op: Op, label: string, fn: () => Promise<{ txHash: string }>) => {
    setBusy(op);
    setError(null);
    setDone(null);
    const again = () => void run(op, label, fn);
    try {
      const r = await fn();
      setDone({ label, tx: r.txHash });
      setConfirm(null);
      void reload();
    } catch (e) {
      setError({ op, plain: plain(e), retry: again });
    } finally {
      setBusy(null);
    }
  };

  const wallet = () => writeClient(account);
  const grant = (seconds: number, request?: Hex) =>
    run(`grant-${seconds}-${request ?? ""}`, `granted +${duration(seconds)}`, async () => {
      if (!bundle) throw new Plainly("The case is still loading.");
      return grantExtension(wallet(), bundle, { seconds, ...(request ? { request } : {}) });
    });

  const disclose = () =>
    run("disclose", "disclosed early", async () => {
      if (!bundle || !k) throw new Plainly("The advisory key for this case is not in this browser.");
      const check = verifyRevealKey(caseKey, caseEntity.payload, k);
      if (!check.bundle || !check.checks.decrypts) throw new Plainly("The advisory key stored in this browser does not open this case, so it cannot be disclosed from here.");
      return discloseEarly(wallet(), bundle, k, check.bundle.vendor, check.bundle.inbox);
    });

  return (
    <CaseCard
      title={report?.advisory.title ?? "A case filed from this wallet"}
      sev={Number(caseEntity.attrs.sev ?? 0)}
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
        <dt>clock</dt>
        <dd>
          <Hash value={caseEntity.payload.clock} />
          {holder && (
            <span className="muted">
              {" "}
              · held by {eqAddr(holder, account.address) ? "you" : <Hash value={holder} kind="address" />}
            </span>
          )}
        </dd>
        <dt>vendor</dt>
        <dd>
          {v?.vendor ? <b>{v.vendor.name}</b> : <span className="muted">sealed until the deadline</span>}
          {v && (
            <span className={s.tags}>
              {v.ackedAt !== undefined ? <span className="tag verd">acknowledged</span> : <span className="tag">no answer yet</span>}
              {v.fixedAt !== undefined && <span className="tag verd">fixed</span>}
              {v.extensions.granted > 0 && <span className="tag">+{duration(v.extensions.seconds)} granted</span>}
            </span>
          )}
        </dd>
        <dt>watchers</dt>
        <dd className="mono">
          {caseEntity.payload.k} of {caseEntity.payload.watchers.length} release it
          {v && !live && <span className="muted"> · {v.receipts.valid} published</span>}
        </dd>
      </dl>
      {loadError && !v && <ErrorNote error={{ message: loadError }} onRetry={() => void reload()} retryLabel="Read it again" />}

      {notes.length > 0 && (
        <ul className={s.notes}>
          {notes.map((n) => (
            <li key={n.key}>
              <span className="tag">{n.kind === "ack" ? "acknowledged" : n.kind === "extreq" ? "asked for time" : "fixed"}</span>
              <span className={s.noteText}>“{n.note}”</span>
              <span className="mono muted">block {n.block.toString()}</span>
            </li>
          ))}
        </ul>
      )}

      {report ? <ReportView report={report} label="Your sealed copy (decrypted in this browser)" /> : <p className="note" style={{ marginTop: 12 }}>Your sealed copy does not open with this wallet&apos;s keys.</p>}

      {live && !mine && holder && (
        <p className={s.handed}>
          The clock is held by <Hash value={holder} kind="address" />. Only its holder can extend it, disclose early or withdraw it.
        </p>
      )}

      {mine && (
        <div className={s.actions}>
          {pending.length > 0 && (
            <div className={s.pending}>
              <span className={s.label}>The vendor is asking for time</span>
              {pending.map((p) => (
                <div key={p.key} className="row">
                  <span className="mono">+{duration(p.seconds ?? 0)}</span>
                  <span className="muted mono">block {p.block.toString()}</span>
                  <button type="button" className="btn small" disabled={busy !== null} onClick={() => void grant(p.seconds ?? 0, p.key)}>
                    <Working busy={busy === `grant-${p.seconds ?? 0}-${p.key}`} idle="Grant it" working="Granting…" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={s.group}>
            <span className={s.label}>Grant more time</span>
            <div className="row" style={{ gap: 8 }}>
              {GRANTS.map((g) => (
                <button key={g.s} type="button" className="btn ghost small" disabled={busy !== null} onClick={() => void grant(g.s)}>
                  <Working busy={busy === `grant-${g.s}-`} idle={g.label} working="Granting…" />
                </button>
              ))}
            </div>
            <p className="note">Moves the clock and every escrowed share in one batch, with a grant record.</p>
          </div>

          <div className={s.group}>
            <span className={s.label}>Hand the clock to a coordinator</span>
            <input className="input" value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x… address" aria-label="Coordinator address" spellCheck={false} />
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, public)" maxLength={200} aria-label="Reason" />
            <button
              type="button"
              className="btn ghost small"
              disabled={busy !== null || !toValid}
              onClick={() => void run("handoff", "handed off", async () => handOff(wallet(), bundle!, to as Address, reason.trim() || undefined))}
            >
              <Working busy={busy === "handoff"} idle="Hand it over" />
            </button>
            {to && !toValid && <p className="note">{isAddress(to) ? "That is this wallet." : "That is not an address."}</p>}
          </div>

          <div className={s.group}>
            <span className={s.label}>End it now</span>
            {confirm === null ? (
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn ghost small" disabled={busy !== null || !k} onClick={() => setConfirm("disclose")}>
                  Disclose early
                </button>
                <button type="button" className="btn ghost small" disabled={busy !== null} onClick={() => setConfirm("withdraw")}>
                  Withdraw
                </button>
              </div>
            ) : (
              <div className={s.confirm} role="group" aria-label="Confirm">
                <p>
                  {confirm === "disclose"
                    ? "Publish the advisory and the vendor's name now, and stop the clock. This cannot be undone."
                    : "Delete the clock. The watchers publish nothing and the advisory stays sealed for good. This cannot be undone."}
                </p>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className={`btn small ${confirm === "withdraw" ? "danger" : ""}`}
                    disabled={busy !== null}
                    onClick={() => void (confirm === "disclose" ? disclose() : run("withdraw", "withdrawn", async () => withdraw(wallet(), bundle!)))}
                  >
                    <Working busy={busy === confirm} idle={confirm === "disclose" ? "Yes, disclose now" : "Yes, withdraw"} />
                  </button>
                  <button type="button" className="btn ghost small" disabled={busy !== null} onClick={() => setConfirm(null)}>
                    Keep it running
                  </button>
                </div>
              </div>
            )}
            {!k && (
              <p className="note">
                Early disclosure needs the advisory key K, which is kept only in the browser that filed the case, and it is not in this one. The
                deadline still publishes the advisory on its own.
              </p>
            )}
          </div>
        </div>
      )}

      {done && (
        <div style={{ marginTop: 12 }}>
          <TxRow label={done.label} value={done.tx} />
        </div>
      )}
      {error && <ErrorNote error={error.plain} onRetry={error.retry} />}
    </CaseCard>
  );
}
