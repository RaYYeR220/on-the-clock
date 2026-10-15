"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { LIFETIME, app, fetchAll, kindIs, listWatchers, type OtcEntity, type ReceiptPayload, type WatcherPayload } from "on-the-clock-sdk";
import { Hash, short } from "@/components/Hash";
import { liveClient, readClient } from "@/lib/arkiv";
import { human, useHead, useSecondsUntil } from "@/lib/hooks";
import css from "./WatcherNetwork.module.css";

type Lease = OtcEntity<WatcherPayload>;

const errText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0]! : String(e));
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const fmt = (n: bigint | number) => n.toLocaleString("en-US").replace(/,/g, " ");
const big = (v: string) => {
  try {
    return /^\d+$/.test(v) ? BigInt(v) : null;
  } catch {
    return null;
  }
};
const hostOf = (u: string) => {
  // A relative URL is this site's relay (/api/watchers/<n>).
  if (u.startsWith("/")) return `watcher ${u.split("/").filter(Boolean).pop()}`;
  try {
    return new URL(statusUrl(u)).host;
  } catch {
    return u;
  }
};

/** Every live lease, kept current by ExpiryExtended events instead of polling for each renewal. */
function useLeases() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renewedAt, setRenewedAt] = useState<Record<string, bigint>>({});
  const [bumps, setBumps] = useState<Record<string, number>>({});
  const keys = useRef(new Set<string>());
  const owners = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const list = await listWatchers(readClient());
      list.sort((a, b) => (a.createdAt === b.createdAt ? (a.creator < b.creator ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
      keys.current = new Set(list.map((l) => l.key.toLowerCase()));
      owners.current = new Set(list.map((l) => l.creator.toLowerCase()));
      setLeases(list);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void load();
      }, 1_500);
    };
    const stop = liveClient().watchEntityEvents({
      onExpiryExtended: (e) => {
        const k = e.entityKey.toLowerCase();
        if (!keys.current.has(k)) return;
        setLeases((prev) => prev?.map((l) => (l.key.toLowerCase() === k ? { ...l, expiresAt: e.expiresAt } : l)) ?? prev);
        setRenewedAt((r) => ({ ...r, [k]: e.blockNumber }));
      },
      // A known watcher created something: a receipt, or a fresh lease after a restart.
      onEntityCreated: (e) => {
        const o = e.owner.toLowerCase();
        if (!owners.current.has(o)) return;
        setBumps((b) => ({ ...b, [o]: (b[o] ?? 0) + 1 }));
        soon();
      },
      onError: () => undefined,
    });
    // New watchers announce themselves with a creation we cannot attribute in advance; a slow poll finds them.
    const poll = setInterval(() => void load(), 30_000);
    return () => {
      stop();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  return { leases, error, renewedAt, bumps, reload: load };
}

function useReceipts(address: Address, bump: number) {
  const [list, setList] = useState<OtcEntity<ReceiptPayload>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchAll<ReceiptPayload>(readClient(), [app(), kindIs("receipt")], { createdBy: address, maxPages: 1 })
      .then((r) => {
        if (!live) return;
        setList([...r].sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1)));
        setError(null);
      })
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [address, bump]);
  return { list, error };
}

const RENEW_AT = 1 - LIFETIME.watcherHeartbeat / LIFETIME.watcherLease;

function LeaseMeter({ secs }: { secs: number | null }) {
  const pct = secs === null ? 0 : Math.min(1, secs / LIFETIME.watcherLease);
  return (
    <div className={css.meter} role="meter" aria-valuemin={0} aria-valuemax={LIFETIME.watcherLease} aria-valuenow={Math.round(secs ?? 0)} aria-label="Lease time left">
      <div className={css.fill} style={{ width: `${pct * 100}%` }} />
      <i className={css.renewMark} style={{ left: `${RENEW_AT * 100}%` }} title="A healthy watcher renews about here" />
    </div>
  );
}

function Outcome({ value }: { value: string }) {
  return <span className={`tag ${value === "lapsed" ? "brass" : ""}`}>{value}</span>;
}

function Receipts({ address, bump }: { address: Address; bump: number }) {
  const { list, error } = useReceipts(address, bump);
  const shown = list?.slice(0, 6) ?? [];
  return (
    <div className={css.receipts}>
      <div className={css.receiptsHead}>
        <span className="eyebrow">Recent receipts</span>
        {list && list.length > 0 && <span className="note mono">{list.length >= 200 ? "200+" : list.length} signed</span>}
      </div>
      {error ? (
        <p className="note">Could not read receipts: {error}</p>
      ) : !list ? (
        <p className="note">Reading receipts…</p>
      ) : list.length === 0 ? (
        <p className="note">None yet. A watcher signs a receipt only when a clock it holds a share for runs out or is withdrawn.</p>
      ) : (
        <ul className={css.receiptList}>
          {shown.map((r) => {
            const caseKey = text(r.attrs.case);
            const outcome = text(r.payload?.outcome) ?? text(r.attrs.outcome) ?? "unknown";
            return (
              <li key={r.key}>
                <Outcome value={outcome} />
                {caseKey ? (
                  <Link className={`mono ${css.caseLink}`} href={`/case/${caseKey}`}>
                    {short(caseKey)}
                  </Link>
                ) : (
                  <span className="mono muted">no case</span>
                )}
                <span className="mono muted">block {fmt(r.createdAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function WatcherCard({
  lease,
  head,
  at,
  renewedAt,
  bump,
  onLapse,
}: {
  lease: Lease;
  head: bigint | null;
  at: number;
  renewedAt: bigint | undefined;
  bump: number;
  onLapse: () => void;
}) {
  const secs = useSecondsUntil(lease.expiresAt, head, at);
  const operator = text(lease.attrs.op) ?? text(lease.payload?.operator) ?? "unnamed operator";
  const region = text(lease.attrs.region);
  const pubkey = text(lease.payload?.pubkey);
  const version = text(lease.payload?.version);

  const [flash, setFlash] = useState(false);
  const last = useRef(lease.expiresAt);
  useEffect(() => {
    if (lease.expiresAt <= last.current) return;
    last.current = lease.expiresAt;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 2_400);
    return () => clearTimeout(t);
  }, [lease.expiresAt]);

  const lapsing = secs !== null && secs <= 0;
  useEffect(() => {
    if (!lapsing) return;
    const t = setTimeout(onLapse, 4_000);
    return () => clearTimeout(t);
  }, [lapsing, onLapse]);

  return (
    <article className={`panel ${css.card}${flash ? ` ${css.flash}` : ""}`}>
      <header className={css.cardHead}>
        <h3>
          <i className={`lamp ${lapsing ? "off" : "blink-b"}`} />
          {operator}
        </h3>
        {region && <span className="tag">{region}</span>}
      </header>

      <div className={css.lease}>
        <div className={css.leaseTop}>
          <span className="eyebrow">Lease left</span>
          <span className={`mono ${css.count}`}>{lapsing ? "lapsing" : human(secs)}</span>
        </div>
        <LeaseMeter secs={secs} />
        <p className="note">
          {flash
            ? "Renewed just now: Lifetime Extension landed."
            : renewedAt !== undefined
              ? `Last renewal seen live at block ${fmt(renewedAt)}.`
              : `Expires at block ${fmt(lease.expiresAt)}. Renewed about every ${LIFETIME.watcherHeartbeat / 60} minutes.`}
        </p>
      </div>

      <dl className={`kv ${css.kv}`}>
        <dt>address</dt>
        <dd>
          <Hash value={lease.creator} kind="address" />
        </dd>
        <dt>encryption key</dt>
        <dd className="mono" title={pubkey ?? undefined}>
          {pubkey ? short(pubkey, 10, 6) : "—"}
        </dd>
        <dt>lease entity</dt>
        <dd>
          <Hash value={lease.key} />
        </dd>
        <dt>since</dt>
        <dd className="mono">block {fmt(lease.createdAt)}</dd>
        {version && (
          <>
            <dt>version</dt>
            <dd className="mono">{version}</dd>
          </>
        )}
      </dl>

      <Receipts address={lease.creator} bump={bump} />
    </article>
  );
}

// ---------- optional /status endpoints ----------

const STATUS_URLS = (process.env.NEXT_PUBLIC_WATCHER_STATUS_URLS ?? "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

interface StatusJob {
  case: string;
  clock: string;
  state: string;
  expiresAt: string;
  outcome: string | null;
  receiptTx: string | null;
}
interface WatcherStatus {
  address: string;
  operator: string | null;
  region: string | null;
  head: string;
  lastTickAt: string | null;
  uptimeSeconds: number;
  jobs: StatusJob[];
}
type Probe = { url: string; status?: WatcherStatus; error?: string };

const statusUrl = (u: string) => (/\/status\/?$/.test(u) ? u : `${u.replace(/\/+$/, "")}/status`);

/** The endpoint is someone else's process: keep only fields of the expected shape. */
function parseStatus(v: unknown): WatcherStatus | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.address !== "string" || !Array.isArray(o.jobs)) return null;
  const jobs: StatusJob[] = [];
  for (const j of o.jobs as unknown[]) {
    if (!j || typeof j !== "object") continue;
    const r = j as Record<string, unknown>;
    if (typeof r.case !== "string" || typeof r.state !== "string") continue;
    jobs.push({
      case: r.case,
      clock: typeof r.clock === "string" ? r.clock : "",
      state: r.state,
      expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : "",
      outcome: typeof r.outcome === "string" ? r.outcome : null,
      receiptTx: typeof r.receiptTx === "string" ? r.receiptTx : null,
    });
  }
  return {
    address: o.address,
    operator: text(o.operator),
    region: text(o.region),
    head: typeof o.head === "string" ? o.head : "",
    lastTickAt: typeof o.lastTickAt === "string" ? o.lastTickAt : null,
    uptimeSeconds: typeof o.uptimeSeconds === "number" ? o.uptimeSeconds : 0,
    jobs,
  };
}

function useStatuses() {
  const [probes, setProbes] = useState<Probe[]>(() => STATUS_URLS.map((url) => ({ url })));
  useEffect(() => {
    if (!STATUS_URLS.length) return;
    let live = true;
    const run = async () => {
      const next = await Promise.all(
        STATUS_URLS.map(async (url): Promise<Probe> => {
          try {
            const res = await fetch(statusUrl(url), { cache: "no-store", signal: AbortSignal.timeout(8_000) });
            if (!res.ok) return { url, error: `HTTP ${res.status}` };
            const status = parseStatus(await res.json());
            return status ? { url, status } : { url, error: "not a watcher status document" };
          } catch (e) {
            return { url, error: errText(e) };
          }
        }),
      );
      if (live) setProbes(next);
    };
    void run();
    const t = setInterval(() => void run(), 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return probes;
}

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s ago` : `${human(s)} ago`;
}

function StatusPanel({ probe, leased }: { probe: Probe; leased: boolean | null }) {
  const st = probe.status;
  return (
    <article className={`panel ${css.status}`}>
      <header className={css.cardHead}>
        <h3 className="mono">{hostOf(probe.url)}</h3>
        {st ? (
          leased === null ? null : leased ? (
            <span className="tag verd">lease on Arkiv</span>
          ) : (
            <span className="tag rust">no live lease</span>
          )
        ) : (
          <span className="tag">{probe.error ? "unreachable" : "asking…"}</span>
        )}
      </header>
      {probe.error && <p className="note">{probe.error}</p>}
      {st && (
        <>
          <dl className={`kv ${css.kv}`}>
            <dt>address</dt>
            <dd>
              <Hash value={st.address} kind="address" />
            </dd>
            <dt>operator</dt>
            <dd>
              {st.operator ?? "—"}
              {st.region ? ` · ${st.region}` : ""}
            </dd>
            <dt>last tick</dt>
            <dd className="mono">
              {ago(st.lastTickAt)} · head {big(st.head) !== null ? fmt(big(st.head)!) : "—"}
            </dd>
            <dt>uptime</dt>
            <dd className="mono">{human(st.uptimeSeconds)}</dd>
          </dl>
          <div className={css.receipts}>
            <div className={css.receiptsHead}>
              <span className="eyebrow">Jobs</span>
              <span className="note mono">{st.jobs.length}</span>
            </div>
            {st.jobs.length === 0 ? (
              <p className="note">No jobs. No case names this watcher yet.</p>
            ) : (
              <ul className={css.receiptList}>
                {st.jobs.map((j) => (
                  <li key={j.case}>
                    <span className={`tag ${j.state === "done" ? "" : j.state === "armed" ? "brass" : "rust"}`}>{j.outcome ?? j.state}</span>
                    <Link className={`mono ${css.caseLink}`} href={`/case/${j.case}`}>
                      case {short(j.case)}
                    </Link>
                    <span className="mono muted">{big(j.expiresAt) !== null ? `due ${fmt(big(j.expiresAt)!)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </article>
  );
}

// ---------- page ----------

const EXPLAIN = [
  {
    t: "A lease, not a heartbeat server",
    b: `Each watcher writes one Arkiv entity with a ${LIFETIME.watcherLease / 60}-minute Entity Expiration and renews it with a Lifetime Extension every ${LIFETIME.watcherHeartbeat / 60} minutes. Being on this page means that lease exists; nobody reports anyone’s liveness.`,
  },
  {
    t: "Stop renewing and you vanish",
    b: "A watcher that crashes or is switched off simply stops extending. Within ten minutes its lease runs out and it drops off this list. Nothing is deleted and nobody has to notice.",
  },
  {
    t: "Shares are escrowed per watcher",
    b: "When a case is filed, the researcher escrows one encrypted share of the advisory key for each watcher it names, in a trigger aimed at that case’s clock. The share is bound to that clock: copied anywhere else, it does not decrypt.",
  },
  {
    t: "Any k of n release",
    b: "One share reveals nothing. When the clock lapses, each watcher proves it and publishes its share; any k of the n rebuild the key, and the watcher that completes the threshold publishes the reveal in the same batch.",
  },
];

export function WatcherNetwork() {
  const { head, at } = useHead();
  const { leases, error, renewedAt, bumps, reload } = useLeases();
  const probes = useStatuses();
  const onLapse = useCallback(() => void reload(), [reload]);
  const leasedBy = new Set((leases ?? []).map((l) => l.creator.toLowerCase()));

  return (
    <main className="page">
      <header className={css.head}>
        <p className="eyebrow">
          <i />
          The network
        </p>
        <h1 className="h-page">The watchers on duty.</h1>
        <p className="lede">
          Arkiv emits nothing when a lifetime runs out. Watchers turn that silence into a signed fact: they notice a clock is gone, prove nobody
          deleted it, and publish their key shares. This list is read live from Arkiv, not from us.
        </p>
      </header>

      <div className={`mono ${css.strip}`}>
        <span>
          <i className={`lamp ${leases?.length ? "blink-a" : "off"}`} />
          <b>{leases ? leases.length : "…"}</b> alive
        </span>
        <span>
          lease <b>{LIFETIME.watcherLease / 60} min</b> Entity Expiration
        </span>
        <span>
          renewed every <b>{LIFETIME.watcherHeartbeat / 60} min</b>
        </span>
        <span>
          head <b>{head ? fmt(head) : "…"}</b>
        </span>
      </div>

      {error && !leases ? (
        <div className={`panel ${css.empty}`}>
          <span className={`${css.mark} ${css.markRust}`} aria-hidden="true">
            <i className="lamp off" />
          </span>
          <div>
            <h3>Could not read Arkiv.</h3>
            <p className="note">{error}</p>
            <button className="btn small ghost" type="button" onClick={() => void reload()} style={{ marginTop: 14 }}>
              Try again
            </button>
          </div>
        </div>
      ) : !leases ? (
        <div className={`panel ${css.empty}`}>
          <i className="lamp blink-a" />
          <p className="note">Reading watcher leases from Arkiv…</p>
        </div>
      ) : leases.length === 0 ? (
        <div className={`panel ${css.empty}`}>
          <span className={css.mark} aria-hidden="true">
            <i className="lamp off" />
          </span>
          <div>
            <h3>No watcher is alive right now.</h3>
            <p className="note">
              No lease entity exists, so no watcher is renewing one. Shares are not lost: they stay escrowed in their triggers, which outlive each
              clock by {LIFETIME.triggerGrace / 86_400} days, and a watcher that comes back re-reads its jobs from Arkiv.{" "}
              <a className="ext" href="#run">
                Run one yourself
              </a>
              .
            </p>
          </div>
        </div>
      ) : (
        <div className={css.cards}>
          {leases.map((l) => (
            <WatcherCard
              key={l.key}
              lease={l}
              head={head}
              at={at}
              renewedAt={renewedAt[l.key.toLowerCase()]}
              bump={bumps[l.creator.toLowerCase()] ?? 0}
              onLapse={onLapse}
            />
          ))}
        </div>
      )}
      {error && leases && <p className="note" style={{ marginTop: 12 }}>Last refresh failed: {error}. Showing the previous read.</p>}

      <section className={css.section}>
        <p className="eyebrow">
          <i />
          How a watcher stays on this list
        </p>
        <h2 className="h-section">Alive means a lease that exists. Nothing else.</h2>
        <ol className="steps">
          {EXPLAIN.map((e, i) => (
            <li key={e.t}>
              <span className="step-n mono">0{i + 1}</span>
              <h3>{e.t}</h3>
              <p>{e.b}</p>
            </li>
          ))}
        </ol>
      </section>

      {STATUS_URLS.length > 0 && (
        <section className={css.section}>
          <p className="eyebrow">
            <i />
            Process status
          </p>
          <h2 className="h-section">What each watcher says about itself.</h2>
          <p className="lede">
            Read from each watcher’s own <span className="mono">/status</span> endpoint. This is the process talking, not Arkiv: the leases above
            are the part anyone can verify.
          </p>
          <div className={css.cards} style={{ marginTop: 28 }}>
            {probes.map((p) => (
              <StatusPanel key={p.url} probe={p} leased={p.status && leases ? leasedBy.has(p.status.address.toLowerCase()) : null} />
            ))}
          </div>
        </section>
      )}

      <section className={css.section} id="run">
        <p className="eyebrow">
          <i />
          Run your own watcher
        </p>
        <h2 className="h-section">One command, one testnet key.</h2>
        <div className={css.run}>
          <p className="lede">
            In this demo, the three watchers are run by the project, on three separate machines. That is a convenience of the demo, not a rule of
            the protocol: a watcher is any wallet that keeps its lease alive and does the job, and anyone can run one. A case names its watchers when
            it is filed, so yours holds shares for the cases that name it.
          </p>
          <dl className={`kv ${css.env}`}>
            <dt className="mono">WATCHER_PRIVATE_KEY</dt>
            <dd>
              The watcher’s wallet: a Tiramisu testnet key with a little test gas. The key its shares are encrypted to is derived from it (unless{" "}
              <span className="mono">WATCHER_ENC_KEY</span> is set), so one secret runs a watcher.
            </dd>
            <dt className="mono">WATCHER_OPERATOR</dt>
            <dd>
              Your label, written to the lease as <span className="mono">op</span>.
            </dd>
            <dt className="mono">WATCHER_REGION</dt>
            <dd>
              Where it runs, written to the lease as <span className="mono">region</span>.
            </dd>
            <dt className="mono">ARKIV_ACCESS_KEY</dt>
            <dd>Optional. An Arkiv access key, for more query budget than the public RPC gives.</dd>
            <dt className="mono">PORT</dt>
            <dd>Optional. Serves the watcher’s status (address, jobs, head, last tick, uptime) as JSON.</dd>
          </dl>
        </div>
        <div className={css.commands}>
          <div className="stack">
            <span className="eyebrow">With Node</span>
            <code className="code">{`WATCHER_PRIVATE_KEY=0x… \\
WATCHER_OPERATOR=your-name \\
WATCHER_REGION=eu-west \\
PORT=8080 \\
npx on-the-clock watch`}</code>
          </div>
          <div className="stack">
            <span className="eyebrow">As a container, from a checkout of the repository</span>
            <code className="code">{`docker build -f docker/watcher.Dockerfile -t on-the-clock-watcher .
docker run -e WATCHER_PRIVATE_KEY=0x... -e WATCHER_OPERATOR=me -p 8080:8080 on-the-clock-watcher`}</code>
            <p className="note">
              Shares live only in memory. On restart the watcher re-reads its job list from Arkiv, the only state it needs. Its lease appears on this
              page shortly after it starts.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
