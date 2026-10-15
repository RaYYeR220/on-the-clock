"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { CaseBundle, CaseStatus } from "on-the-clock-sdk";
import { STATUS, STATUS_ORDER, blocks, sevLabel } from "@/components/CaseText";
import { queryUrl } from "@/lib/arkiv";
import { useBoard, useHead } from "@/lib/hooks";
import { BoardRow } from "./BoardRow";
import s from "./board.module.css";

const BOARD_QUERY = `app = "onclock"`;

/** Running clocks first, soonest deadline first; then closed cases, most recent deadline first. */
function byDeadline(a: CaseBundle, b: CaseBundle) {
  const la = a.view.clock.live, lb = b.view.clock.live;
  if (la !== lb) return la ? -1 : 1;
  const da = la ? a.view.clock.expiresAt : a.view.effectiveExpiry;
  const db = lb ? b.view.clock.expiresAt : b.view.effectiveExpiry;
  if (da === db) return 0;
  return (da < db) === la ? -1 : 1;
}

export default function BoardPage() {
  const { head, at } = useHead();
  const { board, error, reload } = useBoard();
  const [status, setStatus] = useState<CaseStatus | "all">("all");
  const [sev, setSev] = useState<number | "all">("all");

  const cases = useMemo(() => [...(board?.cases ?? [])].sort(byDeadline), [board]);
  const shown = cases.filter((c) => (status === "all" || c.view.status === status) && (sev === "all" || c.view.sev === sev));
  const statuses = STATUS_ORDER.map((st) => ({ st, n: cases.filter((c) => c.view.status === st).length })).filter((x) => x.n > 0);
  const sevs = [4, 3, 2, 1].map((n) => ({ n, count: cases.filter((c) => c.view.sev === n).length })).filter((x) => x.count > 0);

  const running = cases.filter((c) => c.view.clock.live).length;
  const revealed = cases.filter((c) => c.view.status === "revealed" || c.view.status === "disclosed").length;
  const tip = head ?? board?.head ?? null;

  return (
    <main className="page">
      <p className="eyebrow">
        <i />
        Live board
      </p>
      <h1 className="h-page" style={{ marginTop: 14 }}>
        Every clock, in the open.
      </h1>
      <p className="lede">
        Every case On the Clock has written to Arkiv, rebuilt in your browser from one query. While an embargo runs, the board shows that a case
        exists, how severe it is and when it ends. Never the vendor.
      </p>

      <dl className={s.strip} aria-label="Board summary">
        <div>
          <dt>clocks running</dt>
          <dd className="mono">{board ? running : "…"}</dd>
        </div>
        <div>
          <dt>revealed</dt>
          <dd className="mono">{board ? revealed : "…"}</dd>
        </div>
        <div>
          <dt>
            <i className={`lamp ${board?.watchers.length ? "blink-b" : "off"}`} /> watchers alive
          </dt>
          <dd className="mono">{board ? board.watchers.length : "…"}</dd>
        </div>
        <div>
          <dt>current block</dt>
          <dd className="mono">{tip !== null ? blocks(tip) : "…"}</dd>
        </div>
      </dl>

      {error && (
        <div className={s.notice} role="status">
          <span>Could not read Arkiv: {error}</span>
          <button type="button" className="btn ghost small" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      )}

      {!board ? (
        !error && (
          <p className={`${s.loading} mono`} role="status">
            <i className="lamp blink-a" />
            reading every On the Clock entity from Arkiv…
          </p>
        )
      ) : cases.length === 0 ? (
        <section className={`panel ${s.empty}`}>
          <h2>No case is on the board yet.</h2>
          <p className="soft">
            Arkiv has no On the Clock case right now. Cases appear here once their filing batch lands, and stay for the year their records
            live.
          </p>
          <div className="row" style={{ gap: 22, marginTop: 6 }}>
            <Link className="btn" href="/demo">
              Start one in the demo
            </Link>
            <Link className="link" href="/file">
              File a report
            </Link>
          </div>
        </section>
      ) : (
        <>
          <div className={s.filters}>
            <div className={s.group} role="group" aria-label="Filter by status">
              <span className={s.glabel}>status</span>
              <button type="button" className={s.chip} aria-pressed={status === "all"} onClick={() => setStatus("all")}>
                all <span>{cases.length}</span>
              </button>
              {statuses.map(({ st, n }) => (
                <button key={st} type="button" className={s.chip} aria-pressed={status === st} onClick={() => setStatus(st)}>
                  {STATUS[st].label} <span>{n}</span>
                </button>
              ))}
            </div>
            <div className={s.group} role="group" aria-label="Filter by severity">
              <span className={s.glabel}>severity</span>
              <button type="button" className={s.chip} aria-pressed={sev === "all"} onClick={() => setSev("all")}>
                all
              </button>
              {sevs.map(({ n, count }) => (
                <button key={n} type="button" className={s.chip} aria-pressed={sev === n} onClick={() => setSev(n)}>
                  {sevLabel(n)} <span>{count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={s.head} aria-hidden="true">
            <span />
            <span>case</span>
            <span>status</span>
            <span>deadline</span>
            <span>severity</span>
            <span>acked</span>
            <span>ext.</span>
            <span>receipts</span>
          </div>
          {shown.length ? (
            <ol className={s.rows}>
              {shown.map((c) => (
                <BoardRow key={c.view.key} bundle={c} head={head} at={at} />
              ))}
            </ol>
          ) : (
            <div className={s.none}>
              <p className="soft">No case matches these filters.</p>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => {
                  setStatus("all");
                  setSev("all");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </>
      )}

      <p className={`note ${s.source}`}>
        Source: one query, <code className="mono">{BOARD_QUERY}</code>, walked page by page and grouped by case in this browser.{" "}
        <a className="ext" href={queryUrl(BOARD_QUERY)} target="_blank" rel="noreferrer">
          Run it in the Data Explorer
        </a>
        . Each case’s verdicts come from who wrote each entity, never from a field someone filled in.
      </p>
    </main>
  );
}
