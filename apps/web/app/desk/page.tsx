"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Hex } from "viem";
import { app, fetchAll, kindIs, type CasePayload, type OtcEntity } from "on-the-clock-sdk";
import { DeskCase } from "@/components/DeskCase";
import { ErrorNote, Working } from "@/components/DemoParts";
import { WalletCard } from "@/components/WalletCard";
import { readClient } from "@/lib/arkiv";
import { roleKeys } from "@/lib/burner";
import { useHead } from "@/lib/hooks";
import { plain, type Plain } from "@/lib/flow-common";
import { useBurner } from "@/lib/flow-wallet";
import s from "./desk.module.css";

export default function DeskPage() {
  const account = useBurner("researcher");
  const { head, at } = useHead();
  const [selfKey, setSelfKey] = useState<Hex | null>(null);
  const [cases, setCases] = useState<OtcEntity<CasePayload>[] | null>(null);
  const [error, setError] = useState<Plain | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAll<CasePayload>(readClient(), [app(), kindIs("case")], { createdBy: account.address });
      setCases(list.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)));
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
    </main>
  );
}
