import { describe, expect, it } from "vitest";
import {
  generateStealthAddress as refGenerate,
  computeStealthKey as refComputeKey,
  VALID_SCHEME_ID,
} from "@scopelift/stealth-address-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { bytesToHex } from "viem/utils";
import {
  checkStealth,
  generateStealthAddress,
  stealthAddressFromTweak,
  stealthKeysFromPrivate,
  stealthPrivateKey,
  parseMetaAddress,
} from "../src/crypto/stealth.js";
import { eciesDecrypt, eciesEncrypt, open, publicKeyOf, seal, deriveKey } from "../src/crypto/box.js";
import { combineShares, splitKey } from "../src/crypto/shamir.js";
import { KEY_MESSAGE, keysFromSignature } from "../src/crypto/keys.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

const SPEND = "0x0c9b5c0e3b5e9d8c3f1a2b4d6e8f0a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f" as const;
const VIEW = "0x1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e" as const;
const EPH = "0x2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70819" as const;

describe("ERC-5564 scheme 1 stealth inbox", () => {
  const keys = stealthKeysFromPrivate(SPEND, VIEW);

  it("matches the ScopeLift reference SDK for a fixed ephemeral key", () => {
    const ours = generateStealthAddress(keys.metaAddress, EPH);
    const ref = refGenerate({
      stealthMetaAddressURI: keys.metaAddress,
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
      // The reference silently ignores a 0x-prefixed key and picks a random one.
      ephemeralPrivateKey: EPH.slice(2) as `0x${string}`,
    });
    expect(ours.stealthAddress.toLowerCase()).toBe(ref.stealthAddress.toLowerCase());
    expect(ours.ephemeralPublicKey.toLowerCase()).toBe(ref.ephemeralPublicKey.toLowerCase());
    expect(ours.viewTag).toBe(Number.parseInt(ref.viewTag, 16));
  });

  it("derives the same responder private key as the reference and controls the stealth address", () => {
    const g = generateStealthAddress(keys.metaAddress, EPH);
    const match = checkStealth(g.ephemeralPublicKey, g.viewTag, keys);
    expect(match).not.toBeNull();
    const ours = stealthPrivateKey(SPEND, match!.hashedSharedSecret);
    const ref = refComputeKey({
      ephemeralPublicKey: g.ephemeralPublicKey,
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
      spendingPrivateKey: SPEND,
      viewingPrivateKey: VIEW,
    });
    expect(BigInt(ours)).toBe(BigInt(ref));
    expect(privateKeyToAccount(ours).address.toLowerCase()).toBe(g.stealthAddress.toLowerCase());
  });

  it("random ephemeral keys round-trip and only the right vendor matches", () => {
    const other = stealthKeysFromPrivate(VIEW, SPEND);
    let otherMatches = 0;
    for (let i = 0; i < 64; i++) {
      const g = generateStealthAddress(keys.metaAddress);
      const m = checkStealth(g.ephemeralPublicKey, g.viewTag, keys);
      expect(m?.stealthAddress).toBe(g.stealthAddress);
      expect(bytesToHex(m!.sharedSecret)).toBe(bytesToHex(g.sharedSecret));
      const wrong = checkStealth(g.ephemeralPublicKey, g.viewTag, other);
      // A view tag collides 1 time in 256; even then the derived address differs.
      if (wrong) {
        otherMatches++;
        expect(wrong.stealthAddress).not.toBe(g.stealthAddress);
      }
    }
    expect(otherMatches).toBeLessThan(8);
  });

  it("publishing h proves the binding without revealing the shared secret", () => {
    const g = generateStealthAddress(keys.metaAddress, EPH);
    expect(stealthAddressFromTweak(keys.spendingPublicKey, g.hashedSharedSecret)).toBe(g.stealthAddress);
    expect(g.hashedSharedSecret).not.toBe(bytesToHex(g.sharedSecret));
  });

  it("rejects malformed meta-addresses and off-curve points", () => {
    expect(() => parseMetaAddress("st:eth:0x1234")).toThrow();
    expect(() => parseMetaAddress(`st:eth:0x04${"11".repeat(65)}`)).toThrow();
  });
});

describe("sealed boxes", () => {
  it("seal/open round-trips and binds the aad", () => {
    const key = deriveKey(enc.encode("ikm"), "test");
    const box = seal(key, enc.encode("embargoed"), enc.encode("case-1"));
    expect(dec.decode(open(key, box, enc.encode("case-1")))).toBe("embargoed");
    expect(() => open(key, box, enc.encode("case-2"))).toThrow();
  });

  it("ECIES decrypts only for the recipient", () => {
    const pub = publicKeyOf(SPEND);
    const box = eciesEncrypt(pub, enc.encode("share"), enc.encode("trigger"));
    expect(dec.decode(eciesDecrypt(SPEND, box, enc.encode("trigger")))).toBe("share");
    expect(() => eciesDecrypt(VIEW, box, enc.encode("trigger"))).toThrow();
  });
});

describe("threshold release", () => {
  it("any k of n shares rebuild the key; k-1 shares do not", async () => {
    const key = deriveKey(enc.encode("advisory"), "k");
    const shares = await splitKey(key, 3, 2);
    expect(shares).toHaveLength(3);
    for (const pair of [[0, 1], [0, 2], [1, 2]] as const) {
      const rebuilt = await combineShares([shares[pair[0]]!, shares[pair[1]]!]);
      expect(bytesToHex(rebuilt)).toBe(bytesToHex(key));
    }
    await expect(combineShares([shares[0]!])).rejects.toThrow();
  });

  it("refuses nonsense thresholds", async () => {
    await expect(splitKey(new Uint8Array(32), 2, 3)).rejects.toThrow();
    await expect(splitKey(new Uint8Array(32), 3, 1)).rejects.toThrow();
  });
});

describe("keys from a wallet signature", () => {
  it("is deterministic per wallet and distinct across wallets", async () => {
    const a = privateKeyToAccount(SPEND);
    const b = privateKeyToAccount(VIEW);
    const ka1 = keysFromSignature(await a.signMessage({ message: KEY_MESSAGE }));
    const ka2 = keysFromSignature(await a.signMessage({ message: KEY_MESSAGE }));
    const kb = keysFromSignature(await b.signMessage({ message: KEY_MESSAGE }));
    expect(ka1.stealth.metaAddress).toBe(ka2.stealth.metaAddress);
    expect(ka1.selfPrivateKey).toBe(ka2.selfPrivateKey);
    expect(ka1.stealth.metaAddress).not.toBe(kb.stealth.metaAddress);
    expect(ka1.stealth.spendingPrivateKey).not.toBe(ka1.stealth.viewingPrivateKey);
  });
});
