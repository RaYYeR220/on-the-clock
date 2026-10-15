"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Hex } from "viem";
import { app, fetchAll, getOne, isCaseClock, kindIs, listClocksHeldBy, type CasePayload, type OtcEntity } from "on-the-clock-sdk";
import { DeskCase } from "@/components/DeskCase";
import { ErrorNote, Working } from "@/components/DemoParts";
import { WalletCard } from "@/components/WalletCard";
import { readClient } from "@/lib/arkiv";
import { roleKeys } from "@/lib/burner";
import { human, useHead, useSecondsUntil } from "@/lib/hooks";
import { plain, type Plain } from "@/lib/flow-common";
import { useBurner } from "@/lib/flow-wallet";
import s from "./desk.module.css";

type Held = { clock: OtcEntity; caseKey: Hex };

/**
 * Clocks this wallet holds for cases it did not file (a coordinator's custody), found by owner. Anyone
 * can transfer an entity called a clock to anyone, so each one is checked against its case file.
 */
async function heldClocks(owner: Hex, own: Set<string>): Promise<Held[]> {
  const pub = readClient();
  const clocks = (await listClocksHeldBy(pub, owner)).filter((c) => !own.has(String(c.attrs.case ?? "").toLowerCase()));
  const checked = await Promise.all(
    clocks.map(async (clock) => {
      const caseKey = String(clock.attrs.case ?? "") as Hex;
      if (!/^0x[0-9a-fA-F]{64}$/.test(caseKey)) return null;
      const caseEntity = await getOne<CasePayload>(pub, caseKey);
      return caseEntity && isCaseClock(caseEntity, clock) ? { clock, caseKey } : null;
    }),
  );
  return checked.filter((h): h is Held => h !== null);
}

function HeldRow({ held, head, at }: { held: Held; head: bigint | null; at: number }) {
  const secs = useSecondsUntil(held.clock.expiresAt, head, at);
  return (
    <li className={s.heldRow}>
      <Link className="mono link" href={`/case/${held.caseKey}`}>
        {held.caseKey.slice(0, 10)}…{held.caseKey.slice(-4)}
      </Link>
      <span className="mono soft">{secs === null ? "…" : secs > 0 ? `${human(secs)} left` : "lapsing"}</span>
    </li>
  );
}

export default function DeskPage() {
  const account = useBurner("researcher");
  const { head, at } = useHead();
  const [selfKey, setSelfKey] = useState<Hex | null>(null);
  const [cases, setCases] = useState<OtcEntity<CasePayload>[] | null>(null);
  const [held, setHeld] = useState<Held[]>([]);
  const [error, setError] = useState<Plain | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAll<CasePayload>(readClient(), [app(), kindIs("case")], { createdBy: account.address });
      setCases(list.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)));
      setHeld(await heldClocks(account.address, new Set(list.map((c) => c.key.toLowerCase()))));
    } catch (e) {
      setError(plain(e));
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    if (!account) return;
    void load();
    roleKeys(account).then((k) => setSelfKey(k.selfPrivateKey), (e) => setError(plain(e)));
  }, [account, load]);

  return (
    <main className="page">
      <header className={s.head}>
        <p className="eyebrow reveal">
          <i />
          Researcher desk
        </p>
        <h1 className={`h-page reveal d2 ${s.title}`}>Your cases, on the clock.</h1>
        <p className="lede reveal d3">
          Every case this browser&apos;s researcher wallet filed, read straight from Arkiv. You hold each clock: only you can give the vendor more time,
          hand the clock to a coordinator, disclose early or withdraw.
        </p>
      </header>

      <div className={s.top}>
        <div className={s.intro}>
          <p>
            Cases are found by their author, one query: <code className="mono">app = &quot;onclock&quot; &amp;&amp; kind = &quot;case&quot;</code> created by this
            wallet. Each report is decrypted here with your own key; the advisory key K for early disclosure is kept in this browser, per case.
          </p>
          <div className="row">
            <Link className="btn small" href="/file">
              File a report
            </Link>
            <button type="button" className="btn ghost small" onClick={() => void load()} disabled={!account || loading}>
              <Working busy={loading} idle="Read again" working="Reading…" />
            </button>
          </div>
        </div>
        <WalletCard role="researcher" address={account?.address ?? null} exportable />
      </div>

      <section className={s.cases}>
        {error && <ErrorNote error={error} onRetry={() => void load()} />}
        {!cases && !error ? (
          <p className="note">Reading your cases from Arkiv…</p>
        ) : cases && cases.length === 0 ? (
          <div className={s.empty}>
            <p>This browser&apos;s researcher wallet has not filed anything yet.</p>
            <div className="row">
              <Link className="btn ghost small" href="/file">
                File a report
              </Link>
              <Link className="link" href="/demo">
                or watch one run
              </Link>
            </div>
          </div>
        ) : (
          <div className={s.list}>
            {account && selfKey ? (
              cases?.map((c) => <DeskCase key={c.key} caseEntity={c} account={account} selfKey={selfKey} head={head} at={at} />)
            ) : (
              <p className="note">Deriving this wallet&apos;s keys…</p>
            )}
          </div>
        )}
      </section>

      {held.length > 0 && (
        <section className={s.cases}>
          <p className="eyebrow">
            <i />
            In your custody
          </p>
          <p className={`note ${s.heldNote}`}>
            Clocks handed to this wallet for cases it did not file, found by owner:{" "}
            <code className="mono">kind = &quot;clock&quot;</code> owned by this wallet, each checked against its case file. As custodian, this wallet
            is the only one that can extend them.
          </p>
          <ul className={s.held}>
            {held.map((h) => (
              <HeldRow key={h.clock.key} held={h} head={head} at={at} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
