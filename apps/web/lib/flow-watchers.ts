"use client";
import { useCallback, useEffect, useState } from "react";
import { listWatchers, type OtcEntity, type WatcherPayload, type WatcherRef } from "on-the-clock-sdk";
import { readClient } from "./arkiv";
import { plain } from "./flow-common";

export interface WatcherSet {
  refs: WatcherRef[];
  entities: OtcEntity<WatcherPayload>[];
  n: number;
  k: number;
  /** Fewer than two live watchers means nothing could ever release the key. */
  enough: boolean;
}

/** Two of three (or more) when there are enough watchers; never fewer than two shares. */
export const thresholdFor = (n: number) => (n >= 3 ? 2 : Math.max(2, n));

export function watcherSet(list: OtcEntity<WatcherPayload>[]): WatcherSet {
  const entities = list.filter((w) => typeof w.payload?.pubkey === "string" && /^0x0[23][0-9a-f]{64}$/i.test(w.payload.pubkey));
  const refs = entities.map((w) => ({ address: w.creator, pubkey: w.payload.pubkey }));
  const n = refs.length;
  return { refs, entities, n, k: thresholdFor(n), enough: n >= 2 };
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
    const t = setInterval(() => void load(), 45_000);
    return () => clearInterval(t);
  }, [load]);
  return { set, error, reload: load };
}

export const watcherName = (w: OtcEntity<WatcherPayload>) => w.payload?.operator || String(w.attrs.op ?? "") || "watcher";
