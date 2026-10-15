"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Hex } from "viem";
import { BLOCK_SECONDS } from "on-the-clock-sdk";
import { Hash } from "@/components/Hash";
import { DemoDial, WatcherMovement, type DialState, type MovementState } from "@/components/DemoDial";
import { ErrorNote, Receipts, Refusal, TxRow, Working } from "@/components/DemoParts";
import { DemoWatch } from "@/components/DemoWatch";
import { useCase, useHead, useSecondsUntil, human } from "@/lib/hooks";
import { plain, type Plain } from "@/lib/flow-common";
import { glm } from "@/lib/flow-wallet";
import { useWatchers, watcherName, type WatcherSet } from "@/lib/flow-watchers";
import { DEMO_EMBARGO, DEMO_GRANT, RUNNERS, clearDemo, freshDemo, loadDemo, saveDemo, type DemoState } from "@/lib/flow-demo";
import s from "./demo.module.css";

type Live = ReturnType<typeof useCase>;

const STEPS: { title: string; body: string; cta?: string; working?: string }[] = [
  {
    title: "Two throwaway wallets",
    body: "The demo makes two wallets in this browser, one for a vendor and one for a researcher, and asks the demo faucet for a little testnet GLM for each. No extension, no sign-up.",
    cta: "Make the wallets",
    working: "Asking the faucet…",
  },
  {
    title: "The vendor opens an inbox",
    body: "The vendor publishes a stealth meta-address in an inbox entity. Researchers file to those public keys, and only the vendor's private keys can find what was sent.",
    cta: "Open the inbox",
    working: "Creating the inbox…",
  },
  {
    title: "The researcher files it, sealed",
    body: "One atomic batch: the encrypted report, a clock whose Entity Expiration is the embargo (three minutes here), and one escrowed key share per watcher. The case file is handed to 0x…dEaD in the same transaction, so nobody can edit or delete it. Then a little postage goes to the vendor's one-time address.",
    cta: "File the synthetic report",
    working: "Filing…",
  },
  {
    title: "The vendor finds it and answers, unseen",
    body: "The vendor trial-decrypts recent cases against its viewing key, and one opens. From it the vendor derives a one-time responder key, acknowledges, and asks for one more minute, from an address nobody can link to it yet.",
    cta: "Scan and acknowledge",
    working: "Scanning and answering…",
  },
  {
    title: "The vendor tries to move the deadline itself",
    body: "Asking is allowed; taking is not. The vendor's responder calls extendEntity on the clock directly. Only the clock's owner can extend it, and the owner is the researcher.",
    cta: "Try to extend the clock as the vendor",
    working: "Sending the vendor's extension…",
  },
  {
    title: "The researcher grants one more minute",
    body: "The researcher answers the request. One batch moves the clock and every escrowed share by 60 seconds and writes a grant record that points at the request.",
    cta: `Grant +${DEMO_GRANT} s`,
    working: "Granting…",
  },
  {
    title: "The deadline publishes itself",
    body: "Nobody has to do anything now. When the clock's lifetime runs out, Arkiv drops it without an event. The watchers notice, prove it lapsed rather than being deleted, and publish their shares. Two shares rebuild the key, and the advisory and the vendor's name decrypt for everyone.",
  },
  {
    title: "Check it without us",
    body: "Every verdict on the case page is rebuilt from Arkiv in your browser, and the command line does the same straight against the public RPC.",
  },
];

const LAST = STEPS.length - 1;

export default function DemoPage() {
  const [state, setState] = useState<DemoState | null>(null);
  const ref = useRef<DemoState | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<{ step: number; plain: Plain } | null>(null);
  const { set: watchers, error: watchersError, reload: reloadWatchers } = useWatchers();
  const { head, at } = useHead();

  useEffect(() => {
    const s0 = loadDemo() ?? freshDemo();
    ref.current = s0;
    setState(s0);
  }, []);

  const save = useCallback((patch: Partial<DemoState>) => {
    const next = { ...(ref.current ?? freshDemo()), ...patch };
    ref.current = next;
    saveDemo(next);
    setState(next);
  }, []);

  const run = useCallback(
    async (i: number) => {
      const runner = RUNNERS[i];
      if (!runner || running.current) return;
      running.current = true;
      setBusy(i);
      setError(null);
      try {
        await runner({ get: () => ref.current ?? freshDemo(), save, watchers });
      } catch (e) {
        setError({ step: i, plain: plain(e) });
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [save, watchers],
  );

  useEffect(() => {
    if (!state?.auto || busy !== null || error || state.step > 5) return;
    if (state.step === 2 && !watchers?.enough) return;
    const t = setTimeout(() => void run(state.step), 700);
    return () => clearTimeout(t);
  }, [state, busy, error, watchers, run]);

  const revealed = useCallback(() => {
    if (ref.current?.step === 6) save({ step: 7 });
  }, [save]);

  const startOver = () => {
    clearDemo();
    setError(null);
    const next = freshDemo(false);
    ref.current = next;
    saveDemo(next);
    setState(next);
  };

  const view = (live: Live | null) => (
    <div className={s.layout}>
      <ol className={s.steps}>
        {STEPS.map((step, i) => (
          <Step
            key={i}
            i={i}
            state={state}
            live={live}
            busy={busy}
            error={error?.step === i ? error.plain : null}
            watchers={watchers}
            watchersError={watchersError}
            onRun={() => void run(i)}
            onSkip={() => save({ step: 6, skipped: true })}
            onReloadWatchers={() => void reloadWatchers()}
            onStartOver={startOver}
            onRevealed={revealed}
            head={head}
            at={at}
            step={step}
          />
        ))}
      </ol>
      <Plate state={state} live={live} watchers={watchers} head={head} at={at} />
    </div>
  );

  return (
    <main className="page">
      <header className={s.head}>
        <p className="eyebrow reveal">
          <i />
          Watch one run
        </p>
        <h1 className={`h-page reveal d2 ${s.title}`}>One deadline, start to finish.</h1>
        <p className="lede reveal d3">
          Real transactions on the Tiramisu testnet, from two wallets made in this browser. A vendor tries to cheat, the researcher grants a minute,
          and the deadline publishes itself. About five minutes, no setup.
        </p>
        <ul className={`${s.limits} reveal d4`}>
          <li>
            <b>Testnet only.</b> Tiramisu GLM has no value, and every report here is synthetic.
          </li>
          <li>
            <b>The wallets live in this browser.</b> Clearing site data forgets them.
          </li>
          <li>
            <b>The demo&apos;s watchers are run by this project.</b> Anyone can run one; see <Link className="ext" href="/watchers">watchers</Link>.
          </li>
        </ul>
      </header>

      <div className={s.controls}>
        <div className={s.progress} aria-label="Progress">
          <span className="mono">
            {state ? (state.step >= LAST ? "done" : `step ${String(Math.min(state.step, LAST)).padStart(2, "0")} of 0${LAST}`) : "…"}
          </span>
          <span className={s.bar}>
            <span style={{ width: `${state ? (Math.min(state.step, LAST) / LAST) * 100 : 0}%` }} />
          </span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {state && state.step <= 5 && (
            <button type="button" className={`btn ghost small ${state.auto ? s.autoOn : ""}`} aria-pressed={state.auto} onClick={() => save({ auto: !state.auto })}>
              {state.auto ? (
                <>
                  <i className="lamp blink-a" /> Running automatically · pause
                </>
              ) : (
                "Run the rest automatically"
              )}
            </button>
          )}
          {state && state.step > 0 && (
            <button type="button" className="btn ghost small" onClick={startOver} disabled={busy !== null}>
              Start over
            </button>
          )}
        </div>
      </div>

      {!state ? <p className="note">Reading this browser&apos;s progress…</p> : state.filing ? <LiveCase caseKey={state.filing.caseKey} head={head} at={at}>{view}</LiveCase> : view(null)}
    </main>
  );
}

function LiveCase({ caseKey, head, at, children }: { caseKey: Hex; head: bigint | null; at: number; children: (live: Live) => ReactNode }) {
  const live = useCase(caseKey);
  const v = live.bundle?.view;
  const secs = useSecondsUntil(v?.clock.expiresAt, head, at);
  const settled = !!v && ["revealed", "disclosed", "withdrawn"].includes(v.status);
  const near = !!v && secs !== null && secs <= 4;
  const { reload } = live;
  // Arkiv says nothing when a lifetime runs out, so read again around the deadline until it settles.
  useEffect(() => {
    if (!near || settled) return;
    const t = setInterval(() => void reload(), 5_000);
    return () => clearInterval(t);
  }, [near, settled, reload]);
  return <>{children(live)}</>;
}

function Step({
  i,
  state,
  live,
  busy,
  error,
  watchers,
  watchersError,
  onRun,
  onSkip,
  onReloadWatchers,
  onStartOver,
  onRevealed,
  head,
  at,
  step,
}: {
  i: number;
  state: DemoState | null;
  live: Live | null;
  busy: number | null;
  error: Plain | null;
  watchers: WatcherSet | null;
  watchersError: string | null;
  onRun: () => void;
  onSkip: () => void;
  onReloadWatchers: () => void;
  onStartOver: () => void;
  onRevealed: () => void;
  head: bigint | null;
  at: number;
  step: (typeof STEPS)[number];
}) {
  const at0 = state?.step ?? 0;
  const status = i < at0 ? "done" : i === at0 ? "current" : "next";
  const isBusy = busy === i;
  const v = live?.bundle?.view;
  const clockGone = !!v && !v.clock.live;
  const secs = useSecondsUntil(v?.clock.expiresAt, head, at);
  const blockedOnWatchers = i === 2 && !!watchers && !watchers.enough;

  return (
    <li className={`${s.step} ${s[status]}`} aria-current={status === "current" ? "step" : undefined}>
      <span className={`${s.badge} mono`} aria-hidden="true">
        {status === "done" ? "✓" : String(i).padStart(2, "0")}
      </span>
      <div className={s.stepBody}>
        <h2 className={s.stepTitle}>{step.title}</h2>
        {status !== "next" && <p className={s.stepText}>{step.body}</p>}

        {status === "done" && <Done i={i} state={state!} />}

        {status === "current" && step.cta && (
          <>
            {i === 2 && <WatcherGate watchers={watchers} error={watchersError} onReload={onReloadWatchers} />}
            {i >= 3 && i <= 5 && clockGone ? (
              <div className={s.notice}>
                <p>
                  The clock ran out before this step, so there is nothing left for the vendor to push against or for the researcher to extend. The
                  deadline is publishing itself now.
                </p>
                <button type="button" className="btn small" onClick={onSkip}>
                  Skip to the deadline
                </button>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 16 }}>
                <button type="button" className="btn" onClick={onRun} disabled={busy !== null || blockedOnWatchers || (i === 2 && !watchers)}>
                  <Working busy={isBusy} idle={step.cta} working={step.working} />
                </button>
                {i >= 3 && i <= 5 && secs !== null && !state?.auto && (
                  <span className="note">
                    The clock is running: <b className="mono">{human(secs)}</b> left to finish steps 03–05.
                  </span>
                )}
              </div>
            )}
            {error && <ErrorNote error={error} onRetry={onRun} />}
          </>
        )}

        {i === 6 && status !== "next" && state?.filing && live && <DemoWatch live={live} head={head} at={at} onRevealed={onRevealed} done={status === "done"} />}
        {i === 6 && status === "current" && state?.filing && !live && <p className="note">Reading the case from Arkiv…</p>}
        {i === LAST && status === "current" && state?.filing && <Finish caseKey={state.filing.caseKey} onStartOver={onStartOver} />}
      </div>
    </li>
  );
}

function WatcherGate({ watchers, error, onReload }: { watchers: WatcherSet | null; error: string | null; onReload: () => void }) {
  if (error && !watchers)
    return <ErrorNote error={{ message: `Could not read the watcher list: ${error}` }} onRetry={onReload} retryLabel="Read it again" />;
  if (!watchers) return <p className="note" style={{ marginTop: 12 }}>Reading which watchers are on duty…</p>;
  if (!watchers.enough)
    return (
      <div className={s.notice}>
        <p>
          <b>
            {watchers.n === 0 ? "No watchers are" : "Only one watcher is"} on duty right now.
          </b>{" "}
          A filing needs at least two, or nothing could ever release the advisory at the deadline. The demo waits here until they are back.
        </p>
        <button type="button" className="btn ghost small" onClick={onReload}>
          Check again
        </button>
      </div>
    );
  return (
    <p className="note" style={{ marginTop: 12 }}>
      {watchers.n} watchers on duty: the key is split so any <b>{watchers.k}</b> of the {watchers.n} can rebuild it. The vendor holds no share.
    </p>
  );
}

function Done({ i, state }: { i: number; state: DemoState }) {
  switch (i) {
    case 0:
      return state.wallets ? (
        <Receipts>
          <TxRow label="vendor wallet" value={state.wallets.vendor} kind="address" />
          <TxRow label="vendor top-up" value={state.wallets.vendorTx} />
          <TxRow label="researcher wallet" value={state.wallets.researcher} kind="address" />
          <TxRow label="researcher top-up" value={state.wallets.researcherTx} />
          <p className="note">
            Balances when the run started: vendor {glm(BigInt(state.wallets.vendorBalance))}, researcher {glm(BigInt(state.wallets.researcherBalance))}.
          </p>
        </Receipts>
      ) : null;
    case 1:
      return state.inbox ? (
        <Receipts>
          <div className={s.factLine}>
            inbox name <b>{state.inbox.name}</b>
          </div>
          <TxRow label="inbox entity" value={state.inbox.key} kind="entity" />
          <TxRow label="transaction" value={state.inbox.tx} />
        </Receipts>
      ) : null;
    case 2:
      return state.filing ? (
        <Receipts>
          <TxRow label="case file (sealed)" value={state.filing.caseKey} kind="entity" />
          <TxRow label="clock" value={state.filing.clockKey} kind="entity" />
          {state.filing.triggerKeys.map((k, j) => (
            <TxRow key={k} label={`escrowed share ${j + 1}`} value={k} kind="entity" />
          ))}
          <TxRow label="filing batch" value={state.filing.tx} />
          <TxRow label="postage to the responder" value={state.postageTx} />
          <p className="note">
            {state.filing.k} of {state.filing.n} shares release the key. The advisory key K is kept in this browser for early disclosure.
          </p>
        </Receipts>
      ) : null;
    case 3:
      return (
        <Receipts>
          {state.scan && (
            <div className={s.factLine}>
              scanned <b>{state.scan.scanned}</b> cases · <b>{state.scan.matched}</b> opened for this vendor
            </div>
          )}
          <TxRow label="one-time responder" value={state.scan?.responder} kind="address" />
          <TxRow label="acknowledgement" value={state.ack?.key} kind="entity" />
          <TxRow label="ack transaction" value={state.ack?.tx} />
          <TxRow label={`request for +${DEMO_GRANT} s`} value={state.extreq?.key} kind="entity" />
          <TxRow label="request transaction" value={state.extreq?.tx} />
        </Receipts>
      );
    case 4:
      return state.refusal ? <Refusal attempt={state.refusal} /> : state.skipped ? <p className="note">Skipped: the clock had already run out.</p> : null;
    case 5:
      return state.grant ? (
        <Receipts>
          <div className={s.factLine}>
            clock and every share moved <b>+{state.grant.seconds} s</b> in one batch
          </div>
          <TxRow label="grant batch" value={state.grant.tx} />
        </Receipts>
      ) : state.skipped ? (
        <p className="note">Skipped: the clock had already run out.</p>
      ) : null;
    default:
      return null;
  }
}

function movementOf(live: Live | null, watcher: string, lapsed: boolean): MovementState {
  const v = live?.bundle?.view;
  if (!v) return "waiting";
  const mine = v.timeline.filter((t) => t.kind === "receipt" && t.by.toLowerCase() === watcher.toLowerCase());
  if (mine.some((t) => t.outcome === "lapsed" && t.verdict === "verified")) return "released";
  if (mine.some((t) => t.outcome === "withdrawn" || t.outcome === "disclosed")) return "withdrawn";
  return lapsed ? "checking" : "armed";
}

function Plate({ state, live, watchers, head, at }: { state: DemoState | null; live: Live | null; watchers: WatcherSet | null; head: bigint | null; at: number }) {
  const v = live?.bundle?.view;
  const filing = state?.filing;
  const expiresAt = v ? v.clock.expiresAt : filing ? BigInt(filing.deadlineBlock) : null;
  const secs = useSecondsUntil(expiresAt, head, at);
  const created = live?.bundle?.caseEntity.createdAt;
  const total = v && created !== undefined ? Number(v.clock.expiresAt - created) * BLOCK_SECONDS : DEMO_EMBARGO;
  const open = !!v && ["revealed", "revealable", "disclosed"].includes(v.status);
  const lapsed = !!filing && (v ? !v.clock.live || secs === 0 : secs === 0);
  const dial: DialState = !filing ? "idle" : open ? "open" : lapsed ? "lapsed" : "running";
  const list = v ? v.watchers.map((a) => ({ address: a, name: watchers?.entities.find((e) => e.creator.toLowerCase() === a.toLowerCase()) })) : (watchers?.entities ?? []).map((e) => ({ address: e.creator, name: e }));

  return (
    <aside className={`${s.plate} ${filing ? "" : s.unfiled}`} aria-label="The clock">
      <div className={s.plateHead}>
        <h2>The clock</h2>
        {v ? <span className={`tag ${open ? "brass" : ""}`}>{v.status}</span> : <span className="tag">{filing ? "reading…" : "not filed"}</span>}
      </div>
      <DemoDial
        state={dial}
        secondsLeft={secs}
        totalSeconds={total}
        sub={expiresAt !== null ? `deadline block ${expiresAt.toString()}` : `${DEMO_EMBARGO / 60}-minute embargo`}
        {...(dial === "running" && state?.grant ? { caption: `until it publishes itself · +${state.grant.seconds} s granted` } : {})}
      />
      <dl className={s.plateKv}>
        <dt>case</dt>
        <dd>{filing ? <Hash value={filing.caseKey} /> : <span className="muted">—</span>}</dd>
        <dt>clock</dt>
        <dd>{filing ? <Hash value={filing.clockKey} /> : <span className="muted">—</span>}</dd>
        <dt>custodian</dt>
        <dd>{v ? <Hash value={v.custodian} kind="address" /> : state?.wallets ? <Hash value={state.wallets.researcher} kind="address" /> : <span className="muted">—</span>}</dd>
        <dt>vendor</dt>
        <dd>
          {open && v?.vendor ? (
            <b className="brass">{v.vendor.name}</b>
          ) : filing ? (
            <span className="redact" style={{ width: 110 }} title="Sealed until the deadline" />
          ) : (
            <span className="muted">—</span>
          )}
        </dd>
      </dl>
      <div className={s.movements} aria-label="Watcher movements">
        {list.length ? (
          list.slice(0, 5).map((w, j) => (
            <WatcherMovement
              key={w.address}
              label={w.name ? watcherName(w.name) : `${w.address.slice(0, 6)}…`}
              state={filing ? movementOf(live, w.address, lapsed) : "waiting"}
              blink={j}
            />
          ))
        ) : filing ? (
          <p className="note">{live?.error ? "" : "Reading the case's watchers from Arkiv…"}</p>
        ) : (
          <p className="note">{watchers ? "No watchers are on duty right now." : "Reading the watchers…"}</p>
        )}
      </div>
      {filing && live?.error && !v && (
        <ErrorNote error={{ message: `Could not read the case: ${live.error}` }} onRetry={() => void live.reload()} retryLabel="Read it again" />
      )}
      {v && <p className={s.plateNote}>{v.k} of {v.n} watchers must publish to rebuild the key.</p>}
    </aside>
  );
}

function Finish({ caseKey, onStartOver }: { caseKey: Hex; onStartOver: () => void }) {
  return (
    <div className={s.finish}>
      <div className="row" style={{ gap: 14 }}>
        <Link className="btn" href={`/case/${caseKey}`}>
          Open the case file
        </Link>
        <button type="button" className="btn ghost" onClick={onStartOver}>
          Start over
        </button>
      </div>
      <code className="code" style={{ marginTop: 16 }}>
        npx on-the-clock verify {caseKey}
      </code>
      <p className="note" style={{ marginTop: 10 }}>
        The same wallets carry on in the consoles: the vendor&apos;s side is in <Link className="ext" href="/inbox">the vendor inbox</Link>, the
        researcher&apos;s in <Link className="ext" href="/desk">the desk</Link>.
      </p>
    </div>
  );
}
