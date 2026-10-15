"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getAddress, type Address, type Hex } from "viem";
import {
  BLOCK_SECONDS,
  SEVERITY,
  app,
  fetchAll,
  kindIs,
  listRevealsForVendor,
  loadCase,
  type CaseBundle,
  type InboxPayload,
  type OtcEntity,
  type Severity,
} from "on-the-clock-sdk";
import { Hash, short } from "@/components/Hash";
import { readClient } from "@/lib/arkiv";
import { human } from "@/lib/hooks";
import css from "./Vendor.module.css";

/** The URL may carry any casing; Arkiv's addr() insists on a valid checksum, so normalise first. */
const toAddress = (v: string): Address | null => (/^0x[0-9a-fA-F]{40}$/.test(v) ? getAddress(v.toLowerCase()) : null);
const isKey = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const fmt = (n: bigint | number) => n.toLocaleString("en-US").replace(/,/g, " ");
const secs = (blocks: bigint) => Number(blocks) * BLOCK_SECONDS;
const errText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0]! : String(e));

/** Runs `fn` over `items` with at most `n` in flight, so a long history does not burst the RPC budget. */
async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

type Skipped = { key: Hex; reason: string };
interface Card {
  counted: CaseBundle[];
  skipped: Skipped[];
  inboxes: OtcEntity<InboxPayload>[];
  reveals: number;
}

function whyNot(b: CaseBundle | null, vendor: Address): string | null {
  if (!b) return "the case file is not on Arkiv";
  const v = b.view;
  if (v.attribution === "verified") return v.vendor && same(v.vendor.address, vendor) ? null : "the case’s reveal names a different vendor";
  if (v.attribution === "mismatch") return "the named inbox does not match the keys the case was sent to";
  if (v.attribution === "unknown") return "the named inbox is no longer available to check";
  return "no reveal on the case opens it";
}

function useScorecard(vendor: Address | null) {
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    if (!vendor) return;
    setError(null);
    try {
      const pub = readClient();
      const [reveals, inboxes] = await Promise.all([
        listRevealsForVendor(pub, vendor),
        fetchAll<InboxPayload>(pub, [app(), kindIs("inbox")], { createdBy: vendor }),
      ]);
      const keys = [...new Set(reveals.map((r) => r.attrs.case).filter(isKey).map((k) => k.toLowerCase() as Hex))];
      setProgress({ done: 0, total: keys.length });
      let done = 0;
      const bundles = await mapLimit(keys, 3, async (k) => {
        const b = await loadCase(pub, k).catch(() => null);
        setProgress({ done: ++done, total: keys.length });
        return [k, b] as const;
      });
      const counted: CaseBundle[] = [];
      const skipped: Skipped[] = [];
      for (const [k, b] of bundles) {
        const reason = whyNot(b, vendor);
        if (reason === null && b) counted.push(b);
        else skipped.push({ key: k, reason: reason ?? "not verified" });
      }
      counted.sort((a, b) => (a.caseEntity.createdAt < b.caseEntity.createdAt ? 1 : -1));
      setCard({ counted, skipped, inboxes, reveals: reveals.length });
    } catch (e) {
      setError(errText(e));
    }
  }, [vendor]);

  useEffect(() => {
    void load();
  }, [load]);
  return { card, error, progress, reload: load };
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function rowOf(b: CaseBundle, inboxes: OtcEntity<InboxPayload>[]) {
  const v = b.view;
  const filed = b.caseEntity.createdAt;
  const ackBlocks = v.ackedAt !== undefined ? v.ackedAt - filed : null;
  const inbox = inboxes.find((i) => v.vendor && same(i.key, v.vendor.inbox));
  const sla = typeof inbox?.payload?.sla === "number" ? inbox.payload.sla : null;
  const fixedBefore = v.fixedAt === undefined ? null : v.fixedAt < v.effectiveExpiry;
  const early = v.status === "disclosed" ? "disclosed" : v.revealedEarly ? "early" : "deadline";
  return { v, filed, ackBlocks, sla, fixedBefore, early };
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={css.stat}>
      <span className="eyebrow">{label}</span>
      <b className="mono">{value}</b>
      {note && <span className="note">{note}</span>}
    </div>
  );
}

export function VendorScorecard({ addr }: { addr: string }) {
  const vendor = toAddress(addr.trim());
  const { card, error, progress, reload } = useScorecard(vendor);

  if (!vendor) {
    return (
      <main className="page">
        <p className="eyebrow">
          <i />
          Vendor scorecard
        </p>
        <h1 className={`h-page ${css.title}`}>That is not an address.</h1>
        <p className="lede">
          A scorecard is keyed on the address that created a vendor’s inbox: <span className="mono">0x</span> followed by 40 hex characters.
        </p>
        <Link className="link" href="/vendors" style={{ display: "inline-block", marginTop: 22 }}>
          All vendor inboxes
        </Link>
      </main>
    );
  }

  const rows = card ? card.counted.map((b) => rowOf(b, card.inboxes)) : [];
  const name = card?.counted.find((b) => b.view.vendor)?.view.vendor?.name ?? card?.inboxes[0]?.payload?.name ?? null;
  const acked = rows.filter((r) => r.ackBlocks !== null);
  const medAck = median(acked.map((r) => secs(r.ackBlocks!)));
  const asked = rows.reduce((n, r) => n + r.v.extensions.requested, 0);
  const granted = rows.reduce((n, r) => n + r.v.extensions.granted, 0);
  const grantedSecs = rows.reduce((n, r) => n + r.v.extensions.seconds, 0);
  const fixedBefore = rows.filter((r) => r.fixedBefore === true).length;
  const atDeadline = rows.filter((r) => r.early === "deadline").length;
  const disclosed = rows.filter((r) => r.early === "disclosed").length;
  const releasedEarly = rows.filter((r) => r.early === "early").length;
  const publicNote = [disclosed && `${disclosed} disclosed early by the researcher`, releasedEarly && `${releasedEarly} released early by watchers`].filter(Boolean).join(" · ");

  return (
    <main className="page">
      <header className={css.head}>
        <p className="eyebrow">
          <i />
          Vendor scorecard
        </p>
        <h1 className={`h-page ${css.title}`}>{name ?? (card ? "Unnamed vendor" : short(vendor))}</h1>
        <div className={`row ${css.who}`}>
          <Hash value={vendor} kind="address" />
          {card?.inboxes.length ? (
            <span className="tag">
              {card.inboxes.length} live inbox{card.inboxes.length > 1 ? "es" : ""}
            </span>
          ) : card ? (
            <span className="tag">no live inbox</span>
          ) : null}
        </div>
        <p className="lede">
          Only cases that are already public count here. While a case is open, nothing on Arkiv says which vendor it belongs to: the vendor is a
          stealth address until the reveal. So this page cannot show open cases, and it never will.
        </p>
      </header>

      {error ? (
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
      ) : !card ? (
        <div className={`panel ${css.empty}`}>
          <i className="lamp blink-a" />
          <p className="note">
            {progress && progress.total > 0
              ? `Rebuilding ${progress.total} case${progress.total > 1 ? "s" : ""} from Arkiv… ${progress.done}/${progress.total}`
              : "Reading reveals that name this vendor…"}
          </p>
        </div>
      ) : (
        <>
          {rows.length === 0 ? (
            <div className={`panel ${css.empty}`}>
              <span className={css.mark} aria-hidden="true">
                <i className="lamp off" />
              </span>
              <div>
                <h3>No public cases against this vendor.</h3>
                <p className="note">
                  {card.reveals === 0
                    ? "No reveal on Arkiv names this address. Either no embargo with this vendor has run out yet, or none was ever filed: from the outside, the two look the same, by design."
                    : `${card.reveals} reveal${card.reveals > 1 ? "s" : ""} name this address, but none passed the checks below, so none is counted.`}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className={css.stats}>
                <Stat label="Public cases" value={String(rows.length)} note="revealed and verified" />
                <Stat
                  label="Acknowledged"
                  value={`${acked.length} of ${rows.length}`}
                  note={medAck !== null ? `median ${human(medAck)} after filing` : "never acknowledged"}
                />
                <Stat
                  label="Extensions"
                  value={`${asked} asked · ${granted} granted`}
                  note={granted ? `${human(grantedSecs)} granted in total` : asked ? "none granted" : "none asked for"}
                />
                <Stat label="Fixed before the deadline" value={`${fixedBefore} of ${rows.length}`} />
                <Stat
                  label="How it went public"
                  value={`${atDeadline} at the deadline`}
                  note={publicNote || "none made public early"}
                />
              </div>

              <section className={css.section}>
                <h2 className={css.h2}>Cases</h2>
                <div className={css.table} role="table" aria-label="Cases revealed against this vendor">
                  <div className={css.thead} role="row">
                    <span role="columnheader">Case</span>
                    <span role="columnheader">Filed</span>
                    <span role="columnheader">Time to ack</span>
                    <span role="columnheader">Extensions</span>
                    <span role="columnheader">Fixed</span>
                    <span role="columnheader">Outcome</span>
                  </div>
                  {rows.map((r) => (
                    <div key={r.v.key} className={css.tr} role="row">
                      <span role="cell" className={css.caseCell}>
                        <Link className={`mono ${css.caseLink}`} href={`/case/${r.v.key}`}>
                          {short(r.v.key)}
                        </Link>
                        <span className={`tag ${r.v.sev >= 4 ? "brass" : ""}`}>{SEVERITY[r.v.sev as Severity] ?? "?"}</span>
                      </span>
                      <span role="cell" className="mono">
                        <em className={css.mlabel}>Filed</em>block {fmt(r.filed)}
                      </span>
                      <span role="cell">
                        <em className={css.mlabel}>Time to ack</em>
                        {r.ackBlocks === null ? (
                          <span className="muted">never</span>
                        ) : (
                          <>
                            <span className="mono">{fmt(r.ackBlocks)} blocks</span>
                            <small>
                              {human(secs(r.ackBlocks))}
                              {r.sla !== null ? (secs(r.ackBlocks) <= r.sla * 86_400 ? ` · within its ${r.sla}-day SLA` : ` · past its ${r.sla}-day SLA`) : ""}
                            </small>
                          </>
                        )}
                      </span>
                      <span role="cell">
                        <em className={css.mlabel}>Extensions</em>
                        <span className="mono">
                          {r.v.extensions.requested} asked · {r.v.extensions.granted} granted
                        </span>
                        {r.v.extensions.seconds > 0 && <small>+{human(r.v.extensions.seconds)}</small>}
                      </span>
                      <span role="cell">
                        <em className={css.mlabel}>Fixed</em>
                        {r.fixedBefore === null ? (
                          <span className="muted">not marked fixed</span>
                        ) : r.fixedBefore ? (
                          <>
                            <span className="tag verd">before the deadline</span>
                            <small>{human(secs(r.v.effectiveExpiry - r.v.fixedAt!))} to spare</small>
                          </>
                        ) : (
                          <span className="tag">after the deadline</span>
                        )}
                      </span>
                      <span role="cell">
                        <em className={css.mlabel}>Outcome</em>
                        {r.early === "disclosed" ? (
                          <span className="tag">disclosed early</span>
                        ) : r.early === "early" ? (
                          <span className="tag rust">released before the deadline</span>
                        ) : (
                          <span className="tag brass">revealed at the deadline</span>
                        )}
                        {r.v.reveal && <small className="mono">block {fmt(r.v.reveal.createdAt)}</small>}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          <section className={css.section}>
            <div className={css.method}>
              <div>
                <h2 className={css.h2}>How a case gets counted</h2>
                <p className="note">
                  Each case was found through a reveal entity naming this address, then rebuilt from Arkiv in your browser. The reveal’s{" "}
                  <span className="mono">vendor</span> attribute is only an index someone wrote, so a case counts only when the reveal’s key opens it,
                  proves it was addressed to this vendor’s keys, and the inbox it names was created by this address with those keys. Acknowledgements and
                  fixes come from the case’s one-time responder; the reveal is what proves that address was this vendor’s.
                </p>
              </div>
              {card.skipped.length > 0 && (
                <div>
                  <h3 className={css.h3}>Named here, not counted</h3>
                  <ul className={css.skipped}>
                    {card.skipped.map((s) => (
                      <li key={s.key}>
                        <Link className={`mono ${css.caseLink}`} href={`/case/${s.key}`}>
                          {short(s.key)}
                        </Link>
                        <span className="note">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      <Link className="link" href="/vendors" style={{ display: "inline-block", marginTop: 56 }}>
        All vendor inboxes
      </Link>
    </main>
  );
}
