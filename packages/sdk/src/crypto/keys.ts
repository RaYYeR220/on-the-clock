// Keys derived from a wallet signature, so a researcher or vendor needs nothing but their wallet.
// Local accounts and hardware/browser wallets sign secp256k1 deterministically (RFC 6979), so the
// same wallet always re-derives the same keys.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "viem/utils";
import type { Hex } from "viem";
import { stealthKeysFromPrivate, type StealthKeys } from "./stealth.js";

export const KEY_MESSAGE =
  "On the Clock key derivation v1\n\n" +
  "Signing this message derives your encryption keys for On the Clock.\n" +
  "It is not a transaction and costs nothing. Only sign it on a site you trust.";

const N = secp256k1.Point.CURVE().n;
const enc = new TextEncoder();

/** Reduce 48 uniform bytes into [1, n-1]: the standard hash-to-private-key construction. */
export function deriveScalar(ikm: Uint8Array, purpose: string): Hex {
  const wide = hkdf(sha256, ikm, enc.encode("on-the-clock/keys/v1"), enc.encode(purpose), 48);
  const k = (BigInt(bytesToHex(wide)) % (N - 1n)) + 1n;
  return `0x${k.toString(16).padStart(64, "0")}`;
}

export function keysFromSignature(signature: Hex): { stealth: StealthKeys; selfPrivateKey: Hex } {
  const ikm = hexToBytes(signature);
  return {
    stealth: stealthKeysFromPrivate(deriveScalar(ikm, "spend"), deriveScalar(ikm, "view")),
    selfPrivateKey: deriveScalar(ikm, "self"),
  };
}
