"use client";
import { useState } from "react";
import type { Address } from "viem";
import { exportBurner, type Role } from "@/lib/burner";
import { plain, type Plain } from "@/lib/flow-common";
import { glm, topUp, useBalance } from "@/lib/flow-wallet";
import { ErrorNote, Working } from "./DemoParts";
import { Hash } from "./Hash";
import s from "./WalletCard.module.css";

const ROLE: Record<Role, string> = { researcher: "Researcher wallet", vendor: "Vendor wallet", coordinator: "Coordinator wallet" };

/** This browser's throwaway wallet for a role: address, balance, a faucet top-up and, in the consoles, a key export. */
export function WalletCard({ role, address, exportable = false, nonce = 0, note }: { role: Role; address: Address | null; exportable?: boolean; nonce?: number; note?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Plain | null>(null);
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState<string | null>(null);
  const { balance, error: balErr } = useBalance(address, nonce + tick);

  const fund = async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await topUp(address);
      setTick((t) => t + 1);
    } catch (e) {
      setError(plain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={s.card} aria-label={ROLE[role]}>
      <div className={s.head}>
        <p className="eyebrow">
          <i />
          {ROLE[role]}
        </p>
        <span className="tag">throwaway · testnet</span>
      </div>
      <dl className={s.kv}>
        <dt>address</dt>
        <dd>{address ? <Hash value={address} kind="address" /> : "…"}</dd>
        <dt>balance</dt>
        <dd className="mono">{balErr ? <span className="muted">{balErr}</span> : glm(balance)}</dd>
      </dl>
      <p className="note" style={{ marginTop: 10 }}>
        {note ?? "Made in this browser and kept only here. Clearing site data forgets it."}
      </p>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn ghost small" onClick={fund} disabled={!address || busy}>
          <Working busy={busy} idle="Top up from the demo faucet" working="Asking the faucet…" />
        </button>
      </div>
      {error && <ErrorNote error={error} onRetry={fund} />}
      {exportable && (
        <details className={s.export} onToggle={(e) => !(e.currentTarget as HTMLDetailsElement).open && setShown(null)}>
          <summary>Export this throwaway testnet key</summary>
          <p className="note">
            Anyone with this key controls this wallet and, for a vendor, can read every case sent to its inbox. It is a testnet key made for
            this demo: never send real funds to it.
          </p>
          {shown ? (
            <code className={`code ${s.key}`}>{shown}</code>
          ) : (
            <button type="button" className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setShown(exportBurner(role) ?? "No key is stored for this role in this browser.")}>
              Show the key
            </button>
          )}
        </details>
      )}
    </section>
  );
}
