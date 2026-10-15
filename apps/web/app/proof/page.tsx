"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CaseStamp } from "@/components/CaseStamp";
import { Hash } from "@/components/Hash";
import { blocks, duration } from "@/components/CaseText";
import s from "./proof.module.css";

type Step = { name: string; at: string } & Record<string, unknown>;
type Run = {
  network?: string;
  chainId?: number;
  startedAt: string;
  finishedAt?: string;
  steps: Step[];
  config?: Record<string, unknown>;
  links?: Record<string, unknown>;
};
type Load = { s: "loading" } | { s: "missing" } | { s: "error"; msg: string } | { s: "ok"; run: Run };

const LABEL: Record<string, string> = {
  tx: "transaction",
  postageTx: "responder gas",
  decoyClockTx: "decoy clock",
  inbox: "inbox",
  case: "case",
  clock: "clock",
  triggers: "escrowed shares",
  deadlineBlock: "deadline",
  by: "by",
  scanned: "cases scanned",
  matched: "matched",
  title: "title, as the vendor decrypted it",
  responder: "responder",
  matchesCase: "matches the case",
  entity: "entity",
  seconds: "seconds",
  entities: "forged entities",
  status: "status",
  ackedAt: "acknowledged",
  extensionsGranted: "extensions granted",
  clockLive: "clock running",
  clockOwner: "clock owner",
  deadline: "deadline",
  attribution: "vendor attribution",
  vendor: "vendor",
  revealEntity: "reveal",
  revealOk: "reveal verified",
  advisoryTitle: "advisory title",
  premature: "premature receipts",
  foreign: "foreign receipts",
  receipts: "receipts",
  checks: "checks",
};
const TX_KEYS = new Set(["tx", "postageTx", "decoyClockTx"]);
const BLOCK_KEYS = new Set(["deadlineBlock", "deadline", "ackedAt", "block"]);
const SPECIAL = new Set(["name", "at", "receipts", "checks", "ignored", "rejections"]);

const isStep = (name: string, prefix: string) => name.startsWith(prefix);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function hexKind(k: string, v: string): "tx" | "entity" | "address" | null {
  if (!/^0x[0-9a-fA-F]+$/.test(v)) return null;
  if (v.length === 42) return "address";
  if (v.length !== 66) return null;
  return TX_KEYS.has(k) || /tx$/i.test(k) ? "tx" : "entity";
}

function Value({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined) return <span className="muted">none</span>;
  if (typeof v === "boolean") return <span>{v ? "yes" : "no"}</span>;
  if (typeof v === "number") return <span className="mono">{k === "seconds" ? duration(v) : v}</span>;
  if (typeof v === "string") {
    const kind = hexKind(k, v);
    if (kind) return <Hash value={v} kind={kind} />;
    if (BLOCK_KEYS.has(k) && /^\d+$/.test(v)) return <span className="mono">block {blocks(BigInt(v))}</span>;
    return <span>{v}</span>;
  }
  if (Array.isArray(v)) {
    if (!v.length) return <span className="muted">none</span>;
    return (
      <span className={s.list}>
        {v.map((x, i) => (
          <Value key={i} k={k} v={x} />
        ))}
      </span>
    );
  }
  return <span className="mono">{JSON.stringify(v)}</span>;
}

function Fields({ step, only }: { step: Step; only?: string[] }) {
  const keys = (only ?? Object.keys(step)).filter((k) => !SPECIAL.has(k) && k in step);
  if (!keys.length) return null;
  return (
    <dl className={`kv ${s.kv}`}>
      {keys.map((k) => (
        <div key={k} className={s.pair}>
          <dt>{LABEL[k] ?? k}</dt>
          <dd>
            <Value k={k} v={step[k]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Checks({ checks }: { checks: Record<string, boolean | null> }) {
  return (
    <ul className={s.checks}>
      {Object.entries(checks).map(([k, v]) => (
        <li key={k}>
          <span className={v === true ? s.ok : v === false ? s.bad : "muted"} aria-hidden="true">
            {v === true ? "✓" : v === false ? "✗" : "–"}
          </span>{" "}
          {k} <span className={s.sr}>{v === true ? "passed" : v === false ? "failed" : "not checked"}</span>
        </li>
      ))}
    </ul>
  );
}

function offset(from: string, at: string) {
  const d = Math.max(0, Math.round((Date.parse(at) - Date.parse(from)) / 1000));
  return `+${String(Math.floor(d / 60)).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`;
}

export default function ProofPage() {
  const [load, setLoad] = useState<Load>({ s: "loading" });

  useEffect(() => {
    let on = true;
    fetch("/proof.json", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 404) return { s: "missing" } as const;
        if (!r.ok) return { s: "error", msg: `the server answered ${r.status}` } as const;
        let run: Run;
        try {
          run = JSON.parse(await r.text()) as Run;
        } catch {
          return { s: "error", msg: "proof.json is not valid JSON" } as const;
        }
        if (!Array.isArray(run?.steps)) return { s: "error", msg: "proof.json has no steps" } as const;
        return { s: "ok", run } as const;
      })
      .catch((e: unknown) => ({ s: "error", msg: e instanceof Error ? e.message : String(e) }) as const)
      .then((next) => on && setLoad(next));
    return () => {
      on = false;
    };
  }, []);

  return (
    <main className="page">
      <p className="eyebrow">
        <i />
        Proof
      </p>
      <h1 className="h-page" style={{ marginTop: 14 }}>
        One case, end to end, on Tiramisu.
      </h1>
      <p className="lede">
        A scripted run of the whole protocol against the public testnet: the filing, the vendor’s answers, every refusal, the forgeries, and the
        deadline publishing itself. Every row links to the explorer.
      </p>
      {load.s === "loading" && (
        <p className={`${s.loading} mono`} role="status">
          <i className="lamp blink-a" />
          reading the published run…
        </p>
      )}
      {load.s === "missing" && <Missing />}
      {load.s === "error" && (
        <section className={`panel ${s.missing}`}>
          <h2>The published run could not be read.</h2>
          <p className="soft">{cap(load.msg.replace(/\.$/, ""))}.</p>
        </section>
      )}
      {load.s === "ok" && <RunView run={load.run} />}
    </main>
  );
}

function Missing() {
  return (
    <section className={`panel ${s.missing}`} aria-labelledby="missing-h">
      <h2 id="missing-h">The end-to-end run has not been published yet.</h2>
      <p className="soft">
        This page shows the record of one full run of <span className="mono">scripts/e2e.ts</span> on Tiramisu: every transaction hash and Arkiv
        entity key it produced. No run has been published to this site yet, so there is nothing to show. It never fills in sample data.
      </p>
      <code className="code">{"cd scripts\nnode --env-file=../.env e2e.ts\nnode proof.ts"}</code>
      <p className="note">
        <span className="mono">proof.ts</span> writes PROOF.md and publishes the same record here.
      </p>
      <div className="row" style={{ gap: 22, marginTop: 4 }}>
        <Link className="btn" href="/demo">
          Watch one run in the browser
        </Link>
        <Link className="link" href="/board">
          See the live board
        </Link>
      </div>
    </section>
  );
}

function RunView({ run }: { run: Run }) {
  const steps = run.steps;
  const refusals = steps.filter((x) => isStep(x.name, "refused:"));
  const forged = steps.find((x) => isStep(x.name, "impostor wrote"));
  const derived = steps.find((x) => isStep(x.name, "case as derived"));
  const rejections = (steps.find((x) => isStep(x.name, "watcher rejections"))?.rejections as Record<string, unknown>[] | undefined) ?? [];
  const lifecycle = steps.filter((x) => x !== forged && x !== derived && !isStep(x.name, "refused:") && !isStep(x.name, "watcher rejections"));
  const filed = steps.find((x) => isStep(x.name, "researcher filed"));
  const caseKey = typeof filed?.case === "string" ? filed.case : null;
  const final = steps.find((x) => isStep(x.name, "final state"));
  const ignored = (derived?.ignored as string[] | undefined) ?? [];
  const cfg = run.config ?? {};
  const inProcess = cfg.deployedWatchers === false;

  return (
    <>
      <dl className={s.strip}>
        <div>
          <dt>network</dt>
          <dd className="mono">
            {run.network ?? "tiramisu"} · {run.chainId ?? 7738577}
          </dd>
        </div>
        <div>
          <dt>ran</dt>
          <dd className="mono">
            {run.startedAt.replace("T", " ").slice(0, 16)} UTC{run.finishedAt ? ` · took ${offset(run.startedAt, run.finishedAt).slice(1)}` : ""}
          </dd>
        </div>
        <div>
          <dt>embargo · extension</dt>
          <dd className="mono">
            {String(cfg.embargoSeconds ?? "?")}s · {String(cfg.grantSeconds ?? "?")}s
          </dd>
        </div>
        <div>
          <dt>watchers</dt>
          <dd className="mono">
            {String(cfg.k ?? "?")} of {String(cfg.n ?? "?")} · {cfg.deployedWatchers ? "deployed" : "in-process"}
          </dd>
        </div>
      </dl>
      {(caseKey || final) && (
        <p className={s.outcome}>
          {final && (
            <span>
              Final status <b>{String(final.status)}</b>, reveal verified <b>{final.revealOk ? "yes" : "no"}</b>, vendor attribution{" "}
              <b>{String(final.attribution ?? "none")}</b>
              {final.vendor ? ` (${String(final.vendor)})` : ""}.
            </span>
          )}
          {caseKey && (
            <Link className="link" href={`/case/${caseKey}`}>
              Open this case as Arkiv shows it now
            </Link>
          )}
        </p>
      )}

      <section className={s.section} aria-labelledby="life-h">
        <h2 id="life-h" className={s.h2}>
          The case, from filing to self-publication
        </h2>
        <ol className={s.steps}>
          {lifecycle.map((x, i) => (
            <li key={`${x.name}-${i}`} className={s.step}>
              <span className={`${s.n} mono`}>{String(i + 1).padStart(2, "0")}</span>
              <div className={s.sbody}>
                <p className={s.shead}>
                  <b>{cap(x.name)}</b>
                  <span className="mono muted">{offset(run.startedAt, x.at)}</span>
                </p>
                <Fields step={x} />
                {Array.isArray(x.receipts) && x.receipts.length > 0 && (
                  <ul className={s.receipts}>
                    {(x.receipts as { key: string; by: string; block: string; outcome: string }[]).map((r) => (
                      <li key={r.key}>
                        <span className="tag">{r.outcome}</span> receipt at block {blocks(BigInt(r.block))} by <Hash value={r.by} kind="address" />{" "}
                        <Hash value={r.key} />
                      </li>
                    ))}
                  </ul>
                )}
                {x.checks !== null && typeof x.checks === "object" && <Checks checks={x.checks as Record<string, boolean | null>} />}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={s.section} aria-labelledby="ref-h">
        <h2 id="ref-h" className={s.h2}>
          What the chain refused
        </h2>
        <p className="soft" style={{ marginTop: 8, maxWidth: 640 }}>
          Each attempt was sent as a real transaction. A refusal is a revert on chain, with its reason.
        </p>
        {refusals.length ? (
          <ul className={s.refusals}>
            {refusals.map((r, i) => (
              <li key={`${r.name}-${i}`}>
                <div className={s.rbody}>
                  <b>{cap(r.name.replace(/^refused:\s*/, ""))}</b>
                  <p className={r.reverted ? s.reason : s.bad}>{r.reverted ? String(r.error ?? "reverted") : "This write was not refused."}</p>
                  <p className="note">{typeof r.tx === "string" ? <Hash value={r.tx} kind="tx" /> : "no transaction hash recorded"}</p>
                </div>
                <CaseStamp tone={r.reverted ? "rust" : "ink"}>{r.reverted ? "refused" : "not refused"}</CaseStamp>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ marginTop: 16 }}>
            This run recorded no refusals.
          </p>
        )}
      </section>

      <section className={s.section} aria-labelledby="forge-h">
        <h2 id="forge-h" className={s.h2}>
          Forgeries anyone can write, none of which count
        </h2>
        {forged ? (
          <div className={s.forge}>
            <div className="panel">
              <p className={s.shead}>
                <b>{cap(forged.name)}</b>
                <span className="mono muted">{offset(run.startedAt, forged.at)}</span>
              </p>
              <Fields step={forged} />
              <p className="note" style={{ marginTop: 14 }}>
                Arkiv accepted every one of these writes. Anyone can write anything; what counts is decided by who wrote it.
              </p>
            </div>
            <div className={`panel ${s.ignoredPanel}`}>
              <h3 className={s.h3}>What the state rebuilt from Arkiv ignored</h3>
              {ignored.length ? (
                <ul className={s.ignored}>
                  {ignored.map((line, i) => {
                    const cut = line.indexOf(": ");
                    return (
                      <li key={i}>
                        <span className={s.x} aria-hidden="true">
                          ✗
                        </span>
                        <span>
                          <b>{cut > 0 ? line.slice(0, cut) : line}</b>
                          {cut > 0 && <span className={s.reason}> {line.slice(cut + 2)}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">The run recorded no ignored writes.</p>
              )}
              {derived && <Fields step={derived} only={["status", "ackedAt", "extensionsGranted", "clockLive", "clockOwner", "deadline"]} />}
              <h3 className={s.h3} style={{ marginTop: 22 }}>
                Watchers that refused the copied escrow
              </h3>
              {rejections.length ? (
                <ul className={s.ignored}>
                  {rejections.map((r, i) => (
                    <li key={i}>
                      <span className={s.x} aria-hidden="true">
                        ✗
                      </span>
                      <span>
                        <b>{String(r.watcher ?? "watcher").toLowerCase().replace("_", " ")}</b> <span className={s.reason}>{String(r.reason ?? "")}</span>{" "}
                        {typeof r.trigger === "string" && <Hash value={r.trigger} />}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  {inProcess ? "No watcher logged a rejection in this run." : "Rejections are only logged when the watchers run in-process; this run used the deployed watchers."}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 16 }}>
            This run recorded no forgeries.
          </p>
        )}
      </section>
    </>
  );
}
