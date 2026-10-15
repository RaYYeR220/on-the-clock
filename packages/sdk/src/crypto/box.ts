// Symmetric sealing (XChaCha20-Poly1305), ECIES to a secp256k1 key, and HKDF key derivation.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { bytesToHex, hexToBytes } from "viem/utils";
import type { Hex } from "viem";

const NONCE = 24;
const enc = new TextEncoder();

export function deriveKey(ikm: Uint8Array, info: string, salt?: Uint8Array): Uint8Array {
  return hkdf(sha256, ikm, salt, enc.encode(info), 32);
}

/** nonce ‖ ciphertext ‖ tag, as hex. `aad` binds the box to its context (e.g. the case it belongs to). */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Hex {
  const nonce = randomBytes(NONCE);
  const ct = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  const out = new Uint8Array(NONCE + ct.length);
  out.set(nonce);
  out.set(ct, NONCE);
  return bytesToHex(out);
}

export function open(key: Uint8Array, sealed: Hex, aad?: Uint8Array): Uint8Array {
  const bytes = hexToBytes(sealed);
  if (bytes.length < NONCE + 16) throw new Error("sealed box too short");
  return xchacha20poly1305(key, bytes.subarray(0, NONCE), aad).decrypt(bytes.subarray(NONCE));
}

export interface EciesBox {
  /** Ephemeral compressed public key. */
  e: Hex;
  /** Sealed payload. */
  c: Hex;
}

const ECIES_INFO = "on-the-clock/ecies/v1";

export function eciesEncrypt(recipientPublicKey: Hex, plaintext: Uint8Array, aad?: Uint8Array): EciesBox {
  const eph = secp256k1.utils.randomSecretKey();
  const ephPub = secp256k1.getPublicKey(eph, true);
  const recipient = hexToBytes(recipientPublicKey);
  const shared = secp256k1.getSharedSecret(eph, recipient, true);
  const salt = concat(ephPub, recipient);
  return { e: bytesToHex(ephPub), c: seal(deriveKey(shared, ECIES_INFO, salt), plaintext, aad) };
}

export function eciesDecrypt(recipientPrivateKey: Hex, box: EciesBox, aad?: Uint8Array): Uint8Array {
  const priv = hexToBytes(recipientPrivateKey);
  const ephPub = hexToBytes(box.e);
  const shared = secp256k1.getSharedSecret(priv, ephPub, true);
  const salt = concat(ephPub, secp256k1.getPublicKey(priv, true));
  return open(deriveKey(shared, ECIES_INFO, salt), box.c, aad);
}

export function publicKeyOf(privateKey: Hex): Hex {
  return bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function sha256Hex(data: Uint8Array | string): Hex {
  return bytesToHex(sha256(typeof data === "string" ? enc.encode(data) : data));
}

export { randomBytes };
