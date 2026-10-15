"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { LIFETIME, listInboxes, type InboxPayload, type OtcEntity } from "on-the-clock-sdk";
import { Hash } from "@/components/Hash";
import { readClient } from "@/lib/arkiv";
import css from "./Vendor.module.css";

type Inbox = OtcEntity<InboxPayload>;
interface Vendor {
  address: Address;
  inboxes: Inbox[];
  newest: Inbox;
}

const errText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0]! : String(e));
const days = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function VendorIndex() {
  const router = useRouter();
  const [inboxes, setInboxes] = useState<Inbox[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const valid = /^0x[0-9a-fA-F]{40}$/.test(lookup.trim());

  const load = () => {
    setError(null);
    listInboxes(readClient())
      .then(setInboxes)
      .catch((e: unknown) => setError(errText(e)));
  };
  useEffect(load, []);

  // A vendor is the address that created its inboxes; rotating keys means a new inbox, not a new vendor.
  const vendors = useMemo<Vendor[]>(() => {
    const by = new Map<string, Inbox[]>();
    for (const i of inboxes ?? []) by.set(i.creator.toLowerCase(), [...(by.get(i.creator.toLowerCase()) ?? []), i]);
    return [...by.values()]
      .map((list) => {
        const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return { address: sorted[0]!.creator, inboxes: sorted, newest: sorted[0]! };
      })
      .sort((a, b) => String(a.newest.payload?.name ?? "").localeCompare(String(b.newest.payload?.name ?? "")));
  }, [inboxes]);

  return (
    <main className="page">
      <header className={css.head}>
        <p className="eyebrow">
          <i />
          Vendors
        </p>
        <h1 className={`h-page ${css.title}`}>Every vendor taking reports.</h1>
        <p className="lede">
          A vendor opens an inbox on Arkiv, the equivalent of a security.txt: its stealth keys, its policy and how fast it promises to answer. Each
          scorecard counts only cases that are already public.
        </p>
      </header>

      <form
        className={css.lookup}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) router.push(`/vendors/${lookup.trim().toLowerCase()}`);
        }}
      >
        <label htmlFor="vendor-addr" className="eyebrow">
          Look up any vendor address
        </label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input
            id="vendor-addr"
            className="input mono"
            placeholder="0x…"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button className="btn small" type="submit" disabled={!valid}>
            Scorecard
          </button>
        </div>
        <p className="note">Works for vendors whose inbox is gone too: a scorecard reads reveals, not inboxes.</p>
      </form>

      {error ? (
        <div className={`panel ${css.empty}`}>
          <span className={`${css.mark} ${css.markRust}`} aria-hidden="true">
            <i className="lamp off" />
          </span>
          <div>
            <h3>Could not read Arkiv.</h3>
            <p className="note">{error}</p>
            <button className="btn small ghost" type="button" onClick={load} style={{ marginTop: 14 }}>
              Try again
            </button>
          </div>
        </div>
      ) : !inboxes ? (
        <div className={`panel ${css.empty}`}>
          <i className="lamp blink-a" />
          <p className="note">Reading vendor inboxes from Arkiv…</p>
        </div>
      ) : vendors.length === 0 ? (
        <div className={`panel ${css.empty}`}>
          <span className={css.mark} aria-hidden="true">
            <i className="lamp off" />
          </span>
          <div>
            <h3>No vendor inbox is open on Tiramisu right now.</h3>
            <p className="note">
              An inbox is a {LIFETIME.inboxLease / 86_400}-day lease that the vendor’s activity renews, so one that goes quiet drops off this list.{" "}
              <Link className="ext" href="/inbox">
                Open one from the vendor inbox
              </Link>
              .
            </p>
          </div>
        </div>
      ) : (
        <ul className={css.vendors}>
          {vendors.map((v) => {
            const p = v.newest.payload;
            const sla = days(p?.sla);
            const embargo = days(p?.embargo);
            return (
              <li key={v.address}>
                <div className={css.vName}>
                  <b>{p?.name?.trim() || "Unnamed vendor"}</b>
                  <Hash value={v.address} kind="address" />
                </div>
                <dl className={css.vTerms}>
                  <div>
                    <dt>answers within</dt>
                    <dd className="mono">{sla !== null ? `${sla} day${sla === 1 ? "" : "s"}` : "—"}</dd>
                  </div>
                  <div>
                    <dt>default embargo</dt>
                    <dd className="mono">{embargo !== null ? `${embargo} days` : "—"}</dd>
                  </div>
                  <div>
                    <dt>inbox</dt>
                    <dd>
                      <Hash value={v.newest.key} />
                      {v.inboxes.length > 1 && <span className="note"> +{v.inboxes.length - 1} older</span>}
                    </dd>
                  </div>
                </dl>
                <Link className="btn small ghost" href={`/vendors/${v.address}`}>
                  Scorecard
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {vendors.length > 0 && (
        <p className="note" style={{ marginTop: 16 }}>
          Names and terms are what each vendor wrote into its own inbox. The address that created the inbox is what a scorecard is keyed on.
        </p>
      )}
    </main>
  );
}
