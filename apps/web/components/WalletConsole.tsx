"use client";
// Pieces both consoles share: a case's heading line and a decrypted report.
import type { ReactNode } from "react";
import { SEVERITY, type CaseView, type Report, type Severity } from "on-the-clock-sdk";
import { useSecondsUntil, human } from "@/lib/hooks";
import { Hash } from "./Hash";
import s from "./WalletConsole.module.css";

const STATUS_TONE: Record<string, string> = {
  sealed: "",
  acknowledged: "",
  fixed: "verd",
  lapsed: "brass",
  revealable: "brass",
  revealed: "brass",
  disclosed: "brass",
  withdrawn: "",
};

export function StatusTag({ status }: { status: string }) {
  return <span className={`tag ${STATUS_TONE[status] ?? ""}`}>{status}</span>;
}

export function Countdown({ view, head, at }: { view: CaseView; head: bigint | null; at: number }) {
  const secs = useSecondsUntil(view.clock.live ? view.clock.expiresAt : null, head, at);
  if (!view.clock.live) return <span className="mono muted">deadline passed · block {view.effectiveExpiry.toString()}</span>;
  return (
    <span className={`mono ${s.count}`}>
      <i className="lamp blink-a" /> {secs === null ? "…" : secs === 0 ? "lapsing now" : human(secs)} <span className="muted">left</span>
    </span>
  );
}

export function CaseCard({ title, sev, children, aside }: { title: ReactNode; sev: number; children: ReactNode; aside?: ReactNode }) {
  return (
    <article className={s.card}>
      <header className={s.cardHead}>
        <div className={s.cardTitle}>
          <span className={`tag ${sev >= 4 ? "brass" : ""}`}>{SEVERITY[sev as Severity] ?? `sev ${sev}`}</span>
          <h3>{title}</h3>
        </div>
        {aside}
      </header>
      {children}
    </article>
  );
}

export function ReportView({ report, label }: { report: Report; label: string }) {
  const a = report.advisory;
  return (
    <details className={s.report}>
      <summary>{label}</summary>
      <div className={s.reportBody}>
        <p className={s.reportMeta}>
          <span className="mono">{a.component}</span>
          {a.cwe && <span className="tag">{a.cwe}</span>}
          <span className="muted">credited to {a.researcher}</span>
        </p>
        <Block title="Summary (public at the deadline)">{a.summary}</Block>
        <Block title="Details">{report.details}</Block>
        <Block title="Impact">{report.impact}</Block>
        <Block title="Reproduction">{report.reproduction}</Block>
        <Block title="Contact">{report.contact}</Block>
        <p className={`note mono ${s.poc}`}>proof of concept sha-256 {report.pocHash}</p>
      </div>
    </details>
  );
}

function Block({ title, children }: { title: string; children: string }) {
  if (!children?.trim()) return null;
  return (
    <div className={s.block}>
      <span>{title}</span>
      <p>{children}</p>
    </div>
  );
}

export function KeyRow({ label, value, kind = "entity" }: { label: string; value: string; kind?: "entity" | "tx" | "address" }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <Hash value={value} kind={kind} />
      </dd>
    </>
  );
}
