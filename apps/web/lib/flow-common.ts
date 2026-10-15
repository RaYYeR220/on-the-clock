"use client";
// Small pieces every console shares: storage that never throws, the advisory key K kept per case,
// and errors turned into a sentence a person can act on.
import type { Hex } from "viem";

export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  } catch {
    // Storage blocked or full: progress lives for this tab only.
  }
}

export function removeKey(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing stored
  }
}

const kSlot = (caseKey: string) => `otc.k.${caseKey}`;

/** K opens the advisory. The researcher keeps it for early disclosure; it is never written to Arkiv before a reveal. */
export function saveAdvisoryKey(caseKey: Hex, k: Hex) {
  try {
    localStorage.setItem(kSlot(caseKey), k);
  } catch {
    // Private window: K lives for this tab only, and early disclosure goes with it.
  }
}

export function loadAdvisoryKey(caseKey: Hex): Hex | null {
  try {
    const v = localStorage.getItem(kSlot(caseKey)) ?? localStorage.getItem(kSlot(caseKey.toLowerCase()));
    return v && /^0x[0-9a-f]{64}$/i.test(v) ? (v as Hex) : null;
  } catch {
    return null;
  }
}

/** An error whose message is already written for people. */
export class Plainly extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Plainly";
  }
}

export interface Plain {
  message: string;
  txHash?: Hex;
}

const clip = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function plain(e: unknown): Plain {
  const err = (e ?? {}) as { message?: string; shortMessage?: string; txHash?: unknown };
  const txHash = typeof err.txHash === "string" && /^0x[0-9a-f]{64}$/i.test(err.txHash) ? (err.txHash as Hex) : undefined;
  const say = (message: string): Plain => (txHash ? { message, txHash } : { message });
  if (e instanceof Plainly) return say(e.message);
  const raw = String(err.message ?? e ?? "");
  const first = (err.shortMessage ?? raw.split("\n")[0] ?? "").trim();

  if (/faucet is empty|faucet not configured/i.test(raw))
    return say("The demo faucet has no testnet GLM left right now, so this wallet could not be topped up. Fund it from hub.arkiv.network/faucet, then try again.");
  if (/asked for gas too often|faucet is busy|top-up for this wallet is already/i.test(raw)) return say(first);
  if (/insufficient funds|exceeds the balance|total cost .* exceeds/i.test(raw))
    return say("This wallet does not have enough testnet GLM to pay for the transaction. Top it up, then try again.");
  if (/\b429\b|too many requests|rate.?limit/i.test(raw)) return say("The public Tiramisu RPC is limiting requests right now. Wait a few seconds, then try again.");
  if (/waiting for transaction/i.test(raw)) return say("The transaction was sent but is not confirmed yet. It may still land; give it a few seconds, then try again.");
  if (/nonce too low|replacement transaction underpriced|already known/i.test(raw))
    return say("An earlier transaction from this wallet is still pending. Give it a few seconds, then try again.");
  if (/failed to fetch|fetch failed|networkerror|load failed|timed? ?out|took too long|socket|ECONNRE/i.test(raw))
    return say("Could not reach the Tiramisu testnet. Check your connection, then try again.");
  if (/would shorten its life|ExpiryNotExtended/i.test(raw)) return say("That would shorten the entity's lifetime, which Arkiv never allows. Nothing was changed.");
  if (/EntityNotFound|no entity .* deleted, or have expired/i.test(raw)) return say("The entity is gone: it was deleted or its lifetime ran out.");
  if (/is owned by|NotOwner/i.test(raw)) return say(clip(first.replace(/^Transaction (failed: )?/, "")));
  if (/user rejected|denied/i.test(raw)) return say("The signature was declined.");
  return say(clip(first || "Something went wrong, and the network did not say what."));
}

/** "7 days", "1 hour", "60 seconds": the largest whole unit that fits. */
export function duration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  for (const [n, unit] of [[86_400, "day"], [3600, "hour"], [60, "minute"]] as const) {
    if (s >= n && s % n === 0) return `${s / n} ${unit}${s / n === 1 ? "" : "s"}`;
  }
  if (s >= 3600) return `${(s / 3600).toFixed(1)} hours`;
  if (s >= 120) return `${Math.round(s / 60)} minutes`;
  return `${s} second${s === 1 ? "" : "s"}`;
}
