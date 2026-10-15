// k-of-n split of the advisory key (privy-io/shamir-secret-sharing, GF(256), audited).
import { combine, split } from "shamir-secret-sharing";
import { bytesToHex, hexToBytes } from "viem/utils";
import type { Hex } from "viem";

export async function splitKey(key: Uint8Array, n: number, k: number): Promise<Hex[]> {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 2 || n < k || n > 16) {
    throw new Error(`invalid threshold ${k}-of-${n}`);
  }
  return (await split(key, n, k)).map((s) => bytesToHex(s));
}

/** Combines shares. Fewer than k shares still "combine" to garbage, so callers must verify the result. */
export async function combineShares(shares: Hex[]): Promise<Uint8Array> {
  const unique = [...new Set(shares.map((s) => s.toLowerCase() as Hex))];
  if (unique.length < 2) throw new Error("need at least two shares");
  return combine(unique.map((s) => hexToBytes(s)));
}
