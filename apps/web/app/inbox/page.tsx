"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Hex } from "viem";
import { BLOCK_SECONDS, LIFETIME, app, blocks, createInbox, fetchAll, getOne, kindIs, renewInbox, type InboxCase as Match, type InboxPayload, type OtcEntity, type StealthKeys } from "on-the-clock-sdk";
import { Hash, short } from "@/components/Hash";
import { ErrorNote, TxRow, Working } from "@/components/DemoParts";
import { InboxCase } from "@/components/InboxCase";
import { WalletCard } from "@/components/WalletCard";
import { readClient, writeClient } from "@/lib/arkiv";
import { useHead, human } from "@/lib/hooks";
import { plain, type Plain } from "@/lib/flow-common";
import { scanCases, settle, vendorKeys } from "@/lib/flow-cases";
import { topUp, useBurner } from "@/lib/flow-wallet";
import s from "./inbox.module.css";

export default function InboxPage() {
  const vendor = useBurner("vendor");
  const { head, at } = useHead();
  const [keys, setKeys] = useState<StealthKeys | null>(null);
  const [inboxes, setInboxes] = useState<OtcEntity<InboxPayload>[] | null>(null);
  const [picked, setPicked] = useState<Hex | null>(null);
  const [loadError, setLoadError] = useState<Plain | null>(null);
  const [scan, setScan] = useState<{ scanned: number; matches: Match[] } | null>(null);
  const [scanError, setScanError] = useState<Plain | null>(null);
  const [scanning, setScanning] = useState(false);
  const [nonce, setNonce] = useState(0);

  const loadInboxes = useCallback(async () => {
    if (!vendor) return;
    setLoadError(null);
    try {
      const list = (await fetchAll<InboxPayload>(readClient(), [app(), kindIs("inbox")], { createdBy: vendor.address })).sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
      setInboxes(list);
      setPicked((cur) => (cur && list.some((i) => i.key === cur) ? cur : (list[0]?.key ?? null)));
    } catch (e) {
      setLoadError(plain(e));
    }
  }, [vendor]);

  const runScan = useCallback(async () => {
    if (!keys) return;
    setScanning(true);
    setScanError(null);
    try {
      setScan(await scanCases(keys, 10));
    } catch (e) {
      setScanError(plain(e));
    } finally {
      setScanning(false);
    }
  }, [keys]);

  useEffect(() => {
    if (!vendor) return;
    void loadInboxes();
    vendorKeys(vendor).then(setKeys, (e) => setLoadError(plain(e)));
  }, [vendor, loadInboxes]);

  useEffect(() => {
    void runScan();
  }, [runScan]);

  const refresh = () => {
    void loadInboxes();
    setNonce((n) => n + 1);
  };
  const inbox = inboxes?.find((i) => i.key === picked) ?? null;
  const matches = scan?.matches.slice().sort((a, b) => (a.caseEntity.createdAt > b.caseEntity.createdAt ? -1 : 1)) ?? [];

  return (
    <main className="page">
      <header className={s.head}>
        <p className="eyebrow reveal">
          <i />
          Vendor inbox
        </p>
        <h1 className={`h-page reveal d2 ${s.title}`}>Your vendor console.</h1>
        <p className="lede reveal d3">
          Researchers file to your inbox&apos;s public keys. This browser finds the cases meant for you by trial-decrypting each one; nobody else can
          tell which are yours. You answer each case from its own one-time address.
        </p>
      </header>

      <div className={s.top}>
        <div>
          {!vendor || (!inboxes && !loadError) ? (
            <p className="note">Reading this wallet&apos;s inbox from Arkiv…</p>
          ) : loadError && !inboxes ? (
            <ErrorNote error={{ message: `Could not read your inbox: ${loadError.message}` }} onRetry={() => void loadInboxes()} retryLabel="Read it again" />
          ) : inbox ? (
            keys ? (
              <InboxPanel inbox={inbox} all={inboxes ?? []} onPick={setPicked} keys={keys} head={head} at={at} vendor={vendor} onChanged={refresh} />
            ) : (
              <p className="note">Deriving this wallet&apos;s keys…</p>
            )
          ) : (
            <CreateInbox
              vendor={vendor}
              keys={keys}
              onCreated={(k) => {
                setPicked(k);
                refresh();
              }}
            />
          )}
        </div>
        <WalletCard role="vendor" address={vendor?.address ?? null} exportable nonce={nonce} />
      </div>

      <section className={s.cases}>
        <div className={s.casesHead}>
          <h2>Cases addressed to you</h2>
          <div className="row">
            {scan && (
              <span className="note mono">
                scanned {scan.scanned} · {scan.matches.length} opened
              </span>
            )}
            <button type="button" className="btn ghost small" onClick={() => void runScan()} disabled={!keys || scanning}>
              <Working busy={scanning} idle="Scan again" working="Scanning…" />
            </button>
          </div>
        </div>
        {scanError && <ErrorNote error={scanError} onRetry={() => void runScan()} />}
        {!scan && !scanError ? (
          <p className="note">{keys ? "Trial-decrypting the latest cases on Arkiv…" : "Deriving this wallet's keys…"}</p>
        ) : scan && matches.length === 0 ? (
          <div className={s.empty}>
            <p>
              No case on Arkiv opens with this inbox&apos;s keys yet. Cases filed to it appear here, and only here.
              {!inbox && " Open the inbox first, so researchers have somewhere to file."}
            </p>
            <Link className="link" href="/demo">
              Watch one run end to end
            </Link>
          </div>
        ) : (
          <div className={s.list}>
            {keys && matches.map((m) => <InboxCase key={m.caseEntity.key} match={m} keys={keys} head={head} at={at} />)}
          </div>
        )}
      </section>
    </main>
  );
}

function InboxPanel({
  inbox,
  all,
  onPick,
  keys,
  head,
  at,
  vendor,
  onChanged,
}: {
  inbox: OtcEntity<InboxPayload>;
  all: OtcEntity<InboxPayload>[];
  onPick: (k: Hex) => void;
  keys: StealthKeys;
  head: bigint | null;
  at: number;
  vendor: NonNullable<ReturnType<typeof useBurner>>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Plain | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const p = inboxPayload(inbox);
  const leaseTarget = head !== null ? head + blocks(LIFETIME.inboxLease) : null;
  const leaseLeft = head !== null ? Math.max(0, Number(inbox.expiresAt - head) * BLOCK_SECONDS - (Date.now() - at) / 1000) : null;
  const renewable = leaseTarget !== null && inbox.expiresAt < leaseTarget - 300n;
  const keysMatch = p.meta === keys.metaAddress;

  const renew = async () => {
    setBusy(true);
    setError(null);
    try {
      await topUp(vendor.address);
      const r = await renewInbox(writeClient(vendor), readClient(), inbox.key);
      if (r) setTx(r.txHash);
      onChanged();
    } catch (e) {
      setError(plain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={s.inbox}>
      <div className={s.inboxHead}>
        <div>
          <span className="tag brass">your inbox</span>
          <h2>{p.name}</h2>
        </div>
        {all.length > 1 && (
          <select className={`select ${s.pick}`} value={inbox.key} onChange={(e) => onPick(e.target.value as Hex)} aria-label="Your inboxes">
            {all.map((i) => (
              <option key={i.key} value={i.key}>
                {inboxPayload(i).name} · {short(i.key)}
              </option>
            ))}
          </select>
        )}
      </div>
      <dl className={s.kv}>
        <dt>inbox</dt>
        <dd>
          <Hash value={inbox.key} />
        </dd>
        <dt>promises</dt>
        <dd>
          acknowledges within <b>{p.sla} days</b> · <b>{p.embargo}-day</b> default embargo
        </dd>
        {p.policy && (
          <>
            <dt>policy</dt>
            <dd className="soft">{p.policy}</dd>
          </>
        )}
        {p.contact && (
          <>
            <dt>contact</dt>
            <dd>{p.contact}</dd>
          </>
        )}
        <dt>public keys</dt>
        <dd className="mono" title={p.meta}>
          {p.meta.slice(0, 22)}…{p.meta.slice(-8)}
        </dd>
        <dt>lease</dt>
        <dd>
          {leaseLeft === null ? "…" : human(leaseLeft)} left <span className="muted">· expires at block {inbox.expiresAt.toString()}</span>
        </dd>
      </dl>
      {!keysMatch && <p className="note">This inbox carries different keys than this wallet derives, so cases filed to it will not open here.</p>}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn ghost small" onClick={() => void renew()} disabled={busy || !renewable}>
          <Working busy={busy} idle="Renew the lease for 30 days" working="Renewing…" />
        </button>
        <span className="note">
          {renewable
            ? "The inbox lives while you keep showing up. Anyone with an open case can extend it too, so letting it lapse never hides you."
            : "The lease already runs 30 days or more from now; a filing against it may have extended it."}
        </span>
      </div>
      {tx && <TxRow label="renewed" value={tx} />}
      {error && <ErrorNote error={error} onRetry={() => void renew()} />}
    </section>
  );
}

const inboxPayload = (i: OtcEntity<InboxPayload>) => i.payload ?? ({ name: "unnamed inbox", meta: "", policy: "", sla: 0, embargo: 0 } as unknown as InboxPayload);

function CreateInbox({ vendor, keys, onCreated }: { vendor: NonNullable<ReturnType<typeof useBurner>>; keys: StealthKeys | null; onCreated: (k: Hex) => void }) {
  const [name, setName] = useState("");
  const [sla, setSla] = useState("7");
  const [embargo, setEmbargo] = useState("90");
  const [policy, setPolicy] = useState("Reports are acknowledged within 7 days. We ask for 90 days before publication and will request more time only with a reason.");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Plain | null>(null);
  const valid = name.trim().length > 1 && Number(sla) > 0 && Number(embargo) > 0 && !!keys;

  const create = async () => {
    if (!keys) return;
    setBusy(true);
    setError(null);
    try {
      await topUp(vendor.address);
      const r = await createInbox(writeClient(vendor), {
        name: name.trim(),
        meta: keys.metaAddress,
        policy: policy.trim(),
        sla: Math.round(Number(sla)),
        embargo: Math.round(Number(embargo)),
        ...(contact.trim() ? { contact: contact.trim() } : {}),
      });
      await settle(() => getOne(readClient(), r.entityKey), 8);
      onCreated(r.entityKey);
    } catch (e) {
      setError(plain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={s.inbox}>
      <span className="tag">no inbox yet</span>
      <h2 style={{ marginTop: 10 }}>Open an inbox</h2>
      <p className="note" style={{ marginTop: 6, maxWidth: 560 }}>
        One entity with your name, your promises and your public keys. It is readonly: to rotate keys you open a new inbox, so nobody can swap them
        under an open case.
      </p>
      <div className={s.form}>
        <label className={`field ${s.wide}`}>
          <span className={s.label}>Name, as it appears when a case is revealed</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="Acme Wallet (test)" />
        </label>
        <label className="field">
          <span className={s.label}>Acknowledge within (days)</span>
          <input className="input" type="number" min={1} value={sla} onChange={(e) => setSla(e.target.value)} />
        </label>
        <label className="field">
          <span className={s.label}>Default embargo (days)</span>
          <input className="input" type="number" min={1} value={embargo} onChange={(e) => setEmbargo(e.target.value)} />
        </label>
        <label className={`field ${s.wide}`}>
          <span className={s.label}>Policy</span>
          <textarea className="textarea" value={policy} onChange={(e) => setPolicy(e.target.value)} maxLength={1000} />
        </label>
        <label className={`field ${s.wide}`}>
          <span className={s.label}>Public contact (optional)</span>
          <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} placeholder="security@example.test" />
        </label>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={() => void create()} disabled={!valid || busy}>
          <Working busy={busy} idle="Open the inbox" working="Opening…" />
        </button>
        <span className="note">Testnet only. The lease runs 30 days and renews whenever you come back.</span>
      </div>
      {error && <ErrorNote error={error} onRetry={() => void create()} />}
    </section>
  );
}
