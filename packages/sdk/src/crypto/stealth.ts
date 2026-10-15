// ERC-5564 scheme 1 (secp256k1, view tags) for a data inbox instead of a payment.
//
// The vendor publishes a stealth meta-address in its inbox. For each case the researcher derives a
// one-time "responder" address from it. Only the vendor can find the case (view tag + viewing key)
// and only the vendor can act as the responder (spending key + tweak). Nobody else can link the
// responder to the vendor until the tweak `h` is published at reveal time.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, publicKeyToAddress } from "viem/utils";
import type { Address, Hex } from "viem";

const Point = secp256k1.Point;
const N = Point.CURVE().n;

export type MetaAddress = `st:eth:0x${string}`;

export interface StealthKeys {
  spendingPrivateKey: Hex;
  viewingPrivateKey: Hex;
  spendingPublicKey: Hex;
  viewingPublicKey: Hex;
  metaAddress: MetaAddress;
}

export interface GeneratedStealth {
  stealthAddress: Address;
  ephemeralPublicKey: Hex;
  viewTag: number;
  /** keccak256(shared secret): the scalar tweak. Published only at reveal, as the binding proof. */
  hashedSharedSecret: Hex;
  /** Compressed ECDH point. Never published: it keys the vendor's copy of the report. */
  sharedSecret: Uint8Array;
}

export function stealthKeysFromPrivate(spendingPrivateKey: Hex, viewingPrivateKey: Hex): StealthKeys {
  const spendingPublicKey = bytesToHex(secp256k1.getPublicKey(hexToBytes(spendingPrivateKey), true));
  const viewingPublicKey = bytesToHex(secp256k1.getPublicKey(hexToBytes(viewingPrivateKey), true));
  return {
    spendingPrivateKey,
    viewingPrivateKey,
    spendingPublicKey,
    viewingPublicKey,
    metaAddress: toMetaAddress(spendingPublicKey, viewingPublicKey),
  };
}

export function toMetaAddress(spendingPublicKey: Hex, viewingPublicKey: Hex): MetaAddress {
  return `st:eth:0x${spendingPublicKey.slice(2)}${viewingPublicKey.slice(2)}`;
}

export function parseMetaAddress(meta: string): { spendingPublicKey: Hex; viewingPublicKey: Hex } {
  const raw = meta.startsWith("st:") ? meta.split(":")[2] : meta;
  if (!raw || !/^0x[0-9a-fA-F]{132}$/.test(raw)) throw new Error("invalid stealth meta-address");
  const spendingPublicKey = `0x${raw.slice(2, 68)}` as Hex;
  const viewingPublicKey = `0x${raw.slice(68)}` as Hex;
  // Throws on points that are not on the curve.
  Point.fromHex(spendingPublicKey.slice(2));
  Point.fromHex(viewingPublicKey.slice(2));
  return { spendingPublicKey, viewingPublicKey };
}

function hashSecret(sharedSecret: Uint8Array): Uint8Array {
  return keccak_256(sharedSecret);
}

function scalar(bytes: Uint8Array): bigint {
  const s = BigInt(bytesToHex(bytes)) % N;
  if (s === 0n) throw new Error("degenerate stealth tweak");
  return s;
}

/** Stealth public key = P_spend + h·G, as an address. Anyone holding `h` can recompute it. */
export function stealthAddressFromTweak(spendingPublicKey: Hex, hashedSharedSecret: Hex): Address {
  const P = Point.fromHex(spendingPublicKey.slice(2)).add(Point.BASE.multiply(scalar(hexToBytes(hashedSharedSecret))));
  return publicKeyToAddress(bytesToHex(P.toBytes(false)));
}

export function generateStealthAddress(meta: string, ephemeralPrivateKey?: Hex): GeneratedStealth {
  const { spendingPublicKey, viewingPublicKey } = parseMetaAddress(meta);
  const eph = ephemeralPrivateKey ? hexToBytes(ephemeralPrivateKey) : secp256k1.utils.randomSecretKey();
  const sharedSecret = secp256k1.getSharedSecret(eph, hexToBytes(viewingPublicKey), true);
  const h = hashSecret(sharedSecret);
  const hashedSharedSecret = bytesToHex(h);
  return {
    stealthAddress: stealthAddressFromTweak(spendingPublicKey, hashedSharedSecret),
    ephemeralPublicKey: bytesToHex(secp256k1.getPublicKey(eph, true)),
    viewTag: h[0]!,
    hashedSharedSecret,
    sharedSecret,
  };
}

export interface StealthMatch {
  stealthAddress: Address;
  hashedSharedSecret: Hex;
  sharedSecret: Uint8Array;
}

/** Vendor-side scan. Returns null in ~255/256 cases after one hash, without touching the curve again. */
export function checkStealth(
  ephemeralPublicKey: Hex,
  viewTag: number,
  keys: Pick<StealthKeys, "viewingPrivateKey" | "spendingPublicKey">,
): StealthMatch | null {
  let sharedSecret: Uint8Array;
  try {
    sharedSecret = secp256k1.getSharedSecret(hexToBytes(keys.viewingPrivateKey), hexToBytes(ephemeralPublicKey), true);
  } catch {
    return null;
  }
  const h = hashSecret(sharedSecret);
  if (h[0] !== viewTag) return null;
  const hashedSharedSecret = bytesToHex(h);
  return { stealthAddress: stealthAddressFromTweak(keys.spendingPublicKey, hashedSharedSecret), hashedSharedSecret, sharedSecret };
}

/** The responder's private key: p_spend + h (mod n). Only the spending-key holder can compute it. */
export function stealthPrivateKey(spendingPrivateKey: Hex, hashedSharedSecret: Hex): Hex {
  const k = (BigInt(spendingPrivateKey) + scalar(hexToBytes(hashedSharedSecret))) % N;
  return `0x${k.toString(16).padStart(64, "0")}`;
}
