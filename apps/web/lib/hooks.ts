"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { BLOCK_SECONDS, loadBoard, loadCase, resolveReveal, type Board, type CaseBundle, type RevealResult } from "on-the-clock-sdk";
import { headsClient, liveClient, readClient } from "./arkiv";

/** The chain head, pushed over a WebSocket subscription (newHeads), no polling. */
export function useHead() {
  const [head, setHead] = useState<bigint | null>(null);
  const [at, setAt] = useState<number>(0);
  useEffect(() => {
    const stop = headsClient().watchBlockNumber({
      emitOnBegin: true,
      onBlockNumber: (n: bigint) => {
        setHead(n);
        setAt(Date.now());
      },
      onError: () => undefined,
    });
    return () => stop();
  }, []);
  return { head, at };
}

/** Seconds until `block`, interpolated between blocks so countdowns tick every second. */
export function useSecondsUntil(block: bigint | null | undefined, head: bigint | null, headAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (block == null || head == null) return null;
  const secs = Number(block - head) * BLOCK_SECONDS - (now - headAt) / 1000;
  return Math.max(0, secs);
}

type Watched = { keys: Set<string>; owners: Set<string> };

/**
 * Re-runs `load` when an entity event touches something we track: an extension, delete or transfer on
 * a known key, or a creation by a known author. Entity events carry no attributes, so filtering by
 * author is what keeps a busy testnet from turning into a query storm.
 */
function useEventRefresh(load: () => void, watched: React.MutableRefObject<Watched>, everyMs = 30_000) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load();
      }, 1_200);
    };
    const touches = (k?: string) => !!k && watched.current.keys.has(k.toLowerCase());
    const stop = liveClient().watchEntityEvents({
      onEntityCreated: (e) => watched.current.owners.has(e.owner.toLowerCase()) && soon(),
      onExpiryExtended: (e) => touches(e.entityKey) && soon(),
      onEntityDeleted: (e) => touches(e.entityKey) && soon(),
      onOwnershipTransferred: (e) => touches(e.entityKey) && soon(),
      onError: () => undefined,
    });
    const poll = setInterval(load, everyMs);
    return () => {
      stop();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [load, watched, everyMs]);
}

export function useCase(caseKey: Hex) {
  const [bundle, setBundle] = useState<CaseBundle | null>(null);
  const [reveal, setReveal] = useState<RevealResult | null>(null);
  /** "pending" while K is being rebuilt or verified, "failed" when the published shares do not open the case. */
  const [revealState, setRevealState] = useState<"none" | "pending" | "done" | "failed">("none");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const watched = useRef<Watched>({ keys: new Set(), owners: new Set() });

  const load = useCallback(async () => {
    try {
      const b = await loadCase(readClient(), caseKey);
      if (!b) {
        setError("No On the Clock case with this key on Tiramisu.");
        return;
      }
      setBundle(b);
      setError(null);
      const v = b.view;
      watched.current = {
        keys: new Set([v.key, v.clock.key, ...b.related.map((r) => r.key)].map((k) => k.toLowerCase())),
        owners: new Set([v.researcher, v.responder, v.custodian, ...v.watchers].map((a) => a.toLowerCase())),
      };
      if (["revealable", "revealed", "disclosed"].includes(v.status)) {
        setRevealState((prev) => (prev === "done" ? prev : "pending"));
        const r = await resolveReveal(readClient(), b);
        setReveal(r);
        setRevealState(r && r.checks.decrypts ? "done" : "failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    } finally {
      setLoading(false);
    }
  }, [caseKey]);

  useEffect(() => {
    void load();
  }, [load]);
  useEventRefresh(() => void load(), watched, 20_000);
  return { bundle, reveal, revealState, error, loading, reload: load };
}

export function useBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watched = useRef<Watched>({ keys: new Set(), owners: new Set() });

  const load = useCallback(async () => {
    try {
      const b = await loadBoard(readClient());
      setBoard(b);
      setError(null);
      const keys = new Set<string>();
      const owners = new Set<string>();
      for (const c of b.cases) {
        keys.add(c.view.clock.key.toLowerCase());
        owners.add(c.view.researcher.toLowerCase());
        owners.add(c.view.responder.toLowerCase());
        owners.add(c.view.custodian.toLowerCase());
        for (const w of c.view.watchers) owners.add(w.toLowerCase());
      }
      for (const w of b.watchers) owners.add(w.creator.toLowerCase());
      watched.current = { keys, owners };
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEventRefresh(() => void load(), watched, 30_000);
  return { board, error, reload: load };
}

export function human(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h) return `${h}h ${pad(m)}m ${pad(r)}s`;
  return `${pad(m)}m ${pad(r)}s`;
}
