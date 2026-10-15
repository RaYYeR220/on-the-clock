"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Hex } from "viem";
import { BLOCK_SECONDS, RESPONDER_POSTAGE, SEVERITY, listInboxes, sha256Hex, type FiledCase, type InboxPayload, type OtcEntity, type Severity } from "on-the-clock-sdk";
import { Hash, short } from "@/components/Hash";
import { ErrorNote, Receipts, TxRow, Working } from "@/components/DemoParts";
import { WalletCard } from "@/components/WalletCard";
import { readClient } from "@/lib/arkiv";
import { plain, type Plain } from "@/lib/flow-common";
import { fileReport, sendPostage } from "@/lib/flow-cases";
import { topUp, useBurner } from "@/lib/flow-wallet";
import { useWatchers, watcherName } from "@/lib/flow-watchers";
import s from "./file.module.css";

const DAY = 86_400;
const PRESETS = [
  { s: 300, label: "5 min", sub: "demo" },
  { s: DAY, label: "1 day" },
  { s: 7 * DAY, label: "7 days" },
  { s: 30 * DAY, label: "30 days" },
  { s: 90 * DAY, label: "90 days", sub: "the norm" },
];

interface Form {
  title: string;
  component: string;
  severity: Severity;
  cwe: string;
  summary: string;
  credit: string;
  details: string;
  impact: string;
  reproduction: string;
  contact: string;
  poc: string;
}

const EMPTY: Form = { title: "", component: "", severity: 3, cwe: "", summary: "", credit: "", details: "", impact: "", reproduction: "", contact: "", poc: "" };

const days = (secs: number) => (secs < DAY ? `${Math.round(secs / 60)} minutes` : `${Math.round(secs / DAY)} day${secs === DAY ? "" : "s"}`);

export default function FilePage() {
  const account = useBurner("researcher");
  const { set: watchers, error: watchersError, reload: reloadWatchers } = useWatchers();
  const [inboxes, setInboxes] = useState<OtcEntity<InboxPayload>[] | null>(null);
  const [inboxError, setInboxError] = useState<Plain | null>(null);
  const [inboxKey, setInboxKey] = useState<Hex | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [embargo, setEmbargo] = useState(90 * DAY);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Plain | null>(null);
  const [filed, setFiled] = useState<FiledCase | null>(null);
  const [postageTx, setPostageTx] = useState<Hex | null>(null);
  const [nonce, setNonce] = useState(0);

  const loadInboxes = useCallback(async () => {
    setInboxError(null);
    try {
      const list = (await listInboxes(readClient())).sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
      setInboxes(list);
      const wanted = new URLSearchParams(window.location.search).get("inbox")?.toLowerCase();
      setInboxKey((cur) => cur ?? list.find((i) => i.key.toLowerCase() === wanted)?.key ?? null);
    } catch (e) {
      setInboxError(plain(e));
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    void loadInboxes();
  }, [loadInboxes]);

  const inbox = inboxes?.find((i) => i.key === inboxKey) ?? null;
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pocHash = useMemo(() => (form.poc ? sha256Hex(form.poc) : null), [form.poc]);
  const missing = [
    !inbox && "a vendor inbox",
    !form.title.trim() && "a title",
    !form.component.trim() && "the affected component",
    !form.summary.trim() && "a public summary",
    !form.details.trim() && "the details for the vendor",
  ].filter(Boolean) as string[];
  const ready = missing.length === 0 && !!watchers?.enough && !!account;
  const deadline = mounted ? new Date(Date.now() + embargo * 1000) : null;
  const deadlineText = deadline ? deadline.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "…";

  const submit = async () => {
    if (!account || !inbox || !watchers) return;
    setBusy(true);
    setError(null);
    try {
      let f = filed;
      if (!f) {
        await topUp(account.address, RESPONDER_POSTAGE + RESPONDER_POSTAGE / 4n);
        f = await fileReport(
          account,
          inbox,
          {
            advisory: {
              title: form.title.trim(),
              component: form.component.trim(),
              severity: form.severity,
              ...(form.cwe.trim() ? { cwe: form.cwe.trim() } : {}),
              summary: form.summary.trim(),
              researcher: form.credit.trim() || "anonymous researcher",
            },
            report: { details: form.details.trim(), impact: form.impact.trim(), reproduction: form.reproduction.trim(), contact: form.contact.trim() },
            poc: form.poc,
          },
          embargo,
          watchers,
        );
        setFiled(f);
      }
      setPostageTx(await sendPostage(account, f.sealed.responder));
    } catch (e) {
      setError(plain(e));
    } finally {
      setBusy(false);
      setNonce((n) => n + 1);
    }
  };

  const reset = () => {
    setFiled(null);
    setPostageTx(null);
    setForm(EMPTY);
    setError(null);
  };

  if (filed && postageTx) return <Filed filed={filed} postageTx={postageTx} inboxName={inbox?.payload.name ?? "the vendor"} embargo={embargo} onAnother={reset} />;

  return (
    <main className="page">
      <header className={s.head}>
        <p className="eyebrow reveal">
          <i />
          File a report
        </p>
        <h1 className={`h-page reveal d2 ${s.title}`}>File it sealed. Set the clock.</h1>
        <p className="lede reveal d3">
          The full report is sealed to the vendor alone. The advisory is sealed to a deadline: when it passes, the watchers release the key and it
          publishes itself. Only you can move that deadline.
        </p>
      </header>

      <div className={s.layout}>
        <div className={s.form}>
          <Section n="01" title="Who it goes to" hint="Vendors open an inbox once; its keys are how the case reaches them unseen.">
            {inboxError ? (
              <ErrorNote error={{ message: `Could not read the vendor inboxes: ${inboxError.message}` }} onRetry={() => void loadInboxes()} retryLabel="Read them again" />
            ) : !inboxes ? (
              <p className="note">Reading vendor inboxes from Arkiv…</p>
            ) : inboxes.length === 0 ? (
              <div className={s.empty}>
                <p>No vendor has opened an inbox on Tiramisu yet, so there is nobody to file to.</p>
                <div className="row">
                  <Link className="btn ghost small" href="/inbox">
                    Open a vendor inbox
                  </Link>
                  <Link className="link" href="/demo">
                    or watch one run
                  </Link>
                </div>
              </div>
            ) : (
              <div className={s.inboxes} role="radiogroup" aria-label="Vendor inbox">
                {inboxes.map((i) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={i.key === inboxKey}
                    key={i.key}
                    className={`${s.inbox} ${i.key === inboxKey ? s.picked : ""}`}
                    onClick={() => {
                      setInboxKey(i.key);
                      const match = PRESETS.find((p) => p.s === Number(i.payload.embargo) * DAY);
                      if (match) setEmbargo(match.s);
                    }}
                  >
                    <span className={s.inboxName}>{i.payload.name}</span>
                    <span className={s.inboxMeta}>
                      acknowledges within {i.payload.sla} days · {i.payload.embargo}-day default embargo
                    </span>
                    {i.payload.policy && <span className={s.inboxPolicy}>{i.payload.policy}</span>}
                    <span className={`${s.inboxKey} mono`}>
                      inbox {short(i.key)} · by {short(i.creator)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section n="02" title="The advisory" hint="Released automatically at the deadline, to everyone." tag="public at the deadline">
            <div className={s.fields}>
              <Field label="Title" wide>
                <input className="input" value={form.title} onChange={set("title")} maxLength={140} placeholder="Session tokens survive a password reset" />
              </Field>
              <Field label="Affected component">
                <input className="input" value={form.component} onChange={set("component")} maxLength={120} placeholder="auth/session · rotate()" />
              </Field>
              <Field label="CWE (optional)">
                <input className="input" value={form.cwe} onChange={set("cwe")} maxLength={16} placeholder="CWE-613" />
              </Field>
              <Field label="Severity" wide group>
                <div className={s.seg} role="radiogroup" aria-label="Severity">
                  {([1, 2, 3, 4] as Severity[]).map((v) => (
                    <button type="button" role="radio" aria-checked={form.severity === v} key={v} className={form.severity === v ? s.segOn : ""} onClick={() => setForm((f) => ({ ...f, severity: v }))}>
                      <span className="mono">{v}</span> {SEVERITY[v]}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Summary" wide>
                <textarea className="textarea" value={form.summary} onChange={set("summary")} maxLength={1200} placeholder="What is wrong and who is affected, in a few sentences. No exploit details." />
              </Field>
              <Field label="Credit as (optional)" wide help="Printed in the advisory. Leave empty to stay anonymous.">
                <input className="input" value={form.credit} onChange={set("credit")} maxLength={80} placeholder="anonymous researcher" />
              </Field>
            </div>
          </Section>

          <Section n="03" title="The full report" hint="Sealed to the vendor's keys. Never released automatically, not even at the deadline." tag="vendor only">
            <div className={s.fields}>
              <Field label="Details" wide>
                <textarea className="textarea" rows={5} value={form.details} onChange={set("details")} maxLength={8000} />
              </Field>
              <Field label="Impact" wide>
                <textarea className="textarea" value={form.impact} onChange={set("impact")} maxLength={3000} />
              </Field>
              <Field label="Reproduction" wide>
                <textarea className="textarea" rows={4} value={form.reproduction} onChange={set("reproduction")} maxLength={6000} placeholder={"1. …\n2. …"} />
              </Field>
              <Field label="Contact handle" wide help="How the vendor can reach you. It travels inside the sealed report only.">
                <input className="input" value={form.contact} onChange={set("contact")} maxLength={120} placeholder="@handle, or an email you use for disclosure" />
              </Field>
            </div>
          </Section>

          <Section n="04" title="Proof of concept" hint="Never leaves this browser. Only its SHA-256 goes into the sealed report, so you can later prove what you had." tag="stays here">
            <textarea className={`textarea mono ${s.poc}`} rows={6} value={form.poc} onChange={(e) => setForm((f) => ({ ...f, poc: e.target.value.slice(0, 200_000) }))} placeholder="Paste the exploit, a script, a request. It is hashed here and nowhere else." />
            <p className={`note mono ${s.hash}`}>sha-256 {pocHash ?? "— (empty)"}</p>
          </Section>

          <Section n="05" title="The deadline" hint="The clock's Entity Expiration. Only you, or whoever you hand the clock to, can extend it.">
            <div className={s.seg} role="radiogroup" aria-label="Embargo">
              {PRESETS.map((p) => (
                <button type="button" role="radio" aria-checked={embargo === p.s} key={p.s} className={embargo === p.s ? s.segOn : ""} onClick={() => setEmbargo(p.s)}>
                  {p.label}
                  {p.sub && <span className={s.segSub}>{p.sub}</span>}
                </button>
              ))}
            </div>
            <p className="note" style={{ marginTop: 10 }}>
              Publishes itself around <b className="soft">{deadlineText}</b>, about block +{Math.ceil(embargo / BLOCK_SECONDS).toLocaleString("en-US")}
              {inbox && Number(inbox.payload.embargo) * DAY !== embargo && <> · {inbox.payload.name} asks for {inbox.payload.embargo} days</>}.
            </p>
          </Section>

          <Section n="06" title="Who holds the key" hint="The advisory key is split among independent watchers. The vendor holds no share.">
            {watchersError && !watchers ? (
              <ErrorNote error={{ message: `Could not read the watcher list: ${watchersError}` }} onRetry={() => void reloadWatchers()} retryLabel="Read it again" />
            ) : !watchers ? (
              <p className="note">Reading which watchers are on duty…</p>
            ) : (
              <>
                <ul className={s.watchers}>
                  {watchers.entities.map((w, j) => (
                    <li key={w.key}>
                      <i className={`lamp ${["blink-a", "blink-b", "blink-c"][j % 3]}`} />
                      <b>{watcherName(w)}</b>
                      <span className="muted">{String(w.attrs.region ?? "")}</span>
                      <Hash value={w.creator} kind="address" />
                    </li>
                  ))}
                </ul>
                {watchers.enough ? (
                  <p className={s.threshold}>
                    Any <b>{watchers.k}</b> of these <b>{watchers.n}</b> release the key at the deadline. Fewer than {watchers.k} cannot.
                  </p>
                ) : (
                  <div className={s.empty}>
                    <p>
                      <b>{watchers.n === 0 ? "No watchers are" : "Only one watcher is"} on duty right now.</b> A case needs at least two, or nothing could ever
                      release its advisory. Filing is paused until they are back.
                    </p>
                    <button type="button" className="btn ghost small" onClick={() => void reloadWatchers()}>
                      Check again
                    </button>
                  </div>
                )}
              </>
            )}
          </Section>
        </div>

        <aside className={s.side}>
          <div className={s.summary}>
            <h2>What goes where</h2>
            <dl className={s.sum}>
              <dt>
                <span className="tag">public now</span>
              </dt>
              <dd>
                That a case exists, its severity ({SEVERITY[form.severity]}), its deadline, how many watchers hold shares, and this wallet as its author. The
                rest is ciphertext.
              </dd>
              <dt>
                <span className="tag brass">public at the deadline</span>
              </dt>
              <dd>
                The advisory{form.title.trim() ? <>: “{form.title.trim()}”</> : ""}, its component, severity{form.cwe.trim() ? `, ${form.cwe.trim()}` : ""}, summary and credit, plus the
                vendor&apos;s name{inbox ? <> ({inbox.payload.name})</> : ""}. Around {deadlineText}.
              </dd>
              <dt>
                <span className="tag">sealed to the vendor</span>
              </dt>
              <dd>Details, impact, reproduction and your contact handle. Never released automatically. You keep your own sealed copy.</dd>
              <dt>
                <span className="tag">never leaves this browser</span>
              </dt>
              <dd>The proof of concept. Only its SHA-256 is sealed into the report.</dd>
            </dl>
            <WalletCard role="researcher" address={account?.address ?? null} nonce={nonce} note="Your filings are signed by this throwaway wallet, kept in this browser. Its cases show up on your desk." />
            <button type="button" className={`btn ${s.submit}`} onClick={submit} disabled={!ready || busy}>
              <Working busy={busy} idle={filed ? "Send the vendor's postage again" : "File the sealed case"} working={filed ? "Sending postage…" : "Sealing and filing…"} />
            </button>
            {!ready && !busy && (
              <p className="note">
                {missing.length
                  ? `Still needed: ${missing.join(", ")}.`
                  : !watchers?.enough
                    ? "Paused: fewer than two watchers are on duty."
                    : "Preparing this browser's wallet…"}
              </p>
            )}
            {filed && !postageTx && (
              <p className="note">
                The case is filed (<Hash value={filed.caseKey} />). Only the vendor&apos;s postage, the gas its one-time address answers with, is still to send.
              </p>
            )}
            {error && <ErrorNote error={error} onRetry={submit} />}
            <p className="note">Testnet only. One atomic batch: case file, clock and escrowed shares land together or not at all.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Section({ n, title, hint, tag, children }: { n: string; title: string; hint: string; tag?: string; children: React.ReactNode }) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <span className="mono brass">{n}</span>
        <div>
          <h2>
            {title} {tag && <span className={`tag ${tag === "public at the deadline" ? "brass" : ""}`}>{tag}</span>}
          </h2>
          <p className="note">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, wide, help, group, children }: { label: string; wide?: boolean; help?: string; group?: boolean; children: React.ReactNode }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className={`field ${wide ? s.wide : ""}`}>
      <span className={s.label}>{label}</span>
      {children}
      {help && <span className="note">{help}</span>}
    </Tag>
  );
}

function Filed({ filed, postageTx, inboxName, embargo, onAnother }: { filed: FiledCase; postageTx: Hex; inboxName: string; embargo: number; onAnother: () => void }) {
  return (
    <main className="page">
      <div className={s.done}>
        <span className="stamp brass thunk">filed · sealed</span>
        <h1 className={`h-page ${s.title}`} style={{ marginTop: 22 }}>
          The clock is running.
        </h1>
        <p className="lede">
          Sealed to {inboxName}. In about {days(embargo)} the advisory publishes itself unless you extend it. The vendor can find the case, answer
          it and ask for time; it cannot move the deadline.
        </p>
        <Receipts>
          <TxRow label="case file" value={filed.caseKey} kind="entity" />
          <TxRow label="clock" value={filed.clockKey} kind="entity" />
          <TxRow label="filing batch" value={filed.txHash} />
          <TxRow label="vendor's postage" value={postageTx} />
          <div className={s.factLine}>
            deadline block <b className="mono">{filed.deadlineBlock.toString()}</b> · {filed.sealed.payload.k} of {filed.sealed.payload.watchers.length} watchers release it
          </div>
        </Receipts>
        <p className="note" style={{ marginTop: 14 }}>
          The advisory key K is saved in this browser, so you can disclose early from your desk. It is never written to Arkiv before a reveal. Lose this
          browser&apos;s storage and early disclosure goes with it; the deadline still arrives.
        </p>
        <div className="row" style={{ marginTop: 22, gap: 14 }}>
          <Link className="btn" href={`/case/${filed.caseKey}`}>
            Open the case file
          </Link>
          <Link className="btn ghost" href="/desk">
            Go to your desk
          </Link>
          <button type="button" className="link" style={{ background: "none", border: 0, cursor: "pointer" }} onClick={onAnother}>
            File another
          </button>
        </div>
      </div>
    </main>
  );
}
