"use client";
import { useCallback, useEffect, useState } from "react";
import { listWatchers, type OtcEntity, type WatcherPayload, type WatcherRef } from "on-the-clock-sdk";
import { readClient } from "./arkiv";
import { pollWhileVisible } from "./hooks";
import { plain } from "./flow-common";

/**
 * Watchers a filing trusts by default. Anyone can take out a watcher lease, so "alive" is not
 * "trusted": a set built from every live lease would let someone register enough watchers to hold k
 * shares and open an embargo early. Trust is the researcher's choice; this is the default list.
 */
const DEFAULT_TRUSTED = [
  "0xBDEd5092977488a26A6Eb2C671945A47040298D1",
  "0x5839F13CB0548956ef69c3AbC333F9D16ba5C8eA",
  "0xb0Bae504e74A62EE4FBD8F848e8dB9c08A22167B",
];

export const TRUSTED_WATCHERS: ReadonlySet<string> = new Set(
  (process.env.NEXT_PUBLIC_TRUSTED_WATCHERS?.split(",").map((a) => a.trim()).filter(Boolean) ?? DEFAULT_TRUSTED).map((a) => a.toLowerCase()),
);

export interface WatcherSet {
  refs: WatcherRef[];
  entities: OtcEntity<WatcherPayload>[];
  /** Live watcher leases from addresses outside the trusted list. Shown, never used by default. */
  unvetted: OtcEntity<WatcherPayload>[];
  n: number;
  k: number;
  /** Fewer than two live watchers means nothing could ever release the key. */
  enough: boolean;
}

/** Two of three (or more) when there are enough watchers; never fewer than two shares. */
export const thresholdFor = (n: number) => (n >= 3 ? 2 : Math.max(2, n));

export function watcherSet(list: OtcEntity<WatcherPayload>[]): WatcherSet {
  const wellFormed = list.filter((w) => typeof w.payload?.pubkey === "string" && /^0x0[23][0-9a-f]{64}$/i.test(w.payload.pubkey));
  const entities = wellFormed.filter((w) => TRUSTED_WATCHERS.has(w.creator.toLowerCase()));
  const unvetted = wellFormed.filter((w) => !TRUSTED_WATCHERS.has(w.creator.toLowerCase()));
  const refs = entities.map((w) => ({ address: w.creator, pubkey: w.payload.pubkey }));
  const n = refs.length;
  return { refs, entities, unvetted, n, k: thresholdFor(n), enough: n >= 2 };
}

export async function loadWatcherSet(): Promise<WatcherSet> {
  return watcherSet(await listWatchers(readClient()));
}

export function useWatchers() {
  const [set, setSet] = useState<WatcherSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setSet(await loadWatcherSet());
      setError(null);
    } catch (e) {
      setError(plain(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
    return pollWhileVisible(() => void load(), 90_000);
  }, [load]);
  return { set, error, reload: load };
}

export const watcherName = (w: OtcEntity<WatcherPayload>) => w.payload?.operator || String(w.attrs.op ?? "") || "watcher";
