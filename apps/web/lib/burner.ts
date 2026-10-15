"use client";
// Throwaway testnet wallets, one per role, kept in this browser only. They exist so anyone can try the
// whole flow with no extension, no faucet and no sign-up. Never use them for anything real.
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import { KEY_MESSAGE, keysFromSignature } from "on-the-clock-sdk";

export type Role = "researcher" | "vendor" | "coordinator";
const KEY = (r: Role) => `otc.burner.${r}.v1`;

function read(role: Role): Hex | null {
  try {
    const v = localStorage.getItem(KEY(role));
    return v && /^0x[0-9a-f]{64}$/i.test(v) ? (v as Hex) : null;
  } catch {
    return null;
  }
}

/** Returns this browser's wallet for a role, creating it on first use. */
export function burner(role: Role): PrivateKeyAccount {
  let k = read(role);
  if (!k) {
    k = generatePrivateKey();
    try {
      localStorage.setItem(KEY(role), k);
    } catch {
      // Private window: the wallet lives for this tab only.
    }
  }
  return privateKeyToAccount(k);
}

export function hasBurner(role: Role): boolean {
  return read(role) !== null;
}

export function forgetBurner(role: Role) {
  try {
    localStorage.removeItem(KEY(role));
  } catch {
    // nothing to forget
  }
}

export function exportBurner(role: Role): Hex | null {
  return read(role);
}

const keyCache = new Map<string, ReturnType<typeof keysFromSignature>>();

/** Encryption keys derived from the wallet's signature over a fixed message (deterministic). */
export async function roleKeys(account: PrivateKeyAccount) {
  const hit = keyCache.get(account.address);
  if (hit) return hit;
  const keys = keysFromSignature(await account.signMessage({ message: KEY_MESSAGE }));
  keyCache.set(account.address, keys);
  return keys;
}

/** Asks the demo faucet for gas. Returns the transfer hash, or null when the wallet already has enough. */
export async function ensureGas(address: string): Promise<string | null> {
  const r = await fetch("/api/drip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
  const body = (await r.json().catch(() => ({}))) as { tx?: string; error?: string; skipped?: boolean };
  if (!r.ok) throw new Error(body.error ?? `faucet error ${r.status}`);
  return body.tx ?? null;
}
