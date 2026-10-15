import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { publicKeyOf } from "../src/crypto/box.js";
import { deriveScalar } from "../src/crypto/keys.js";
import { stealthKeysFromPrivate, stealthPrivateKey } from "../src/crypto/stealth.js";
import {
  openForResearcher,
  openForVendor,
  openNote,
  openShare,
  reconstruct,
  sealCase,
  sealNote,
  verifyRevealKey,
} from "../src/seal.js";
import type { InboxPayload, WatcherRef } from "../src/types.js";

const enc = new TextEncoder();
const scalar = (s: string) => deriveScalar(enc.encode(s), "test");

const vendorKeys = stealthKeysFromPrivate(scalar("spend"), scalar("view"));
const otherVendor = stealthKeysFromPrivate(scalar("spend2"), scalar("view2"));
const vendorWallet = privateKeyToAccount(scalar("vendor-wallet")).address;
const inbox = {
  key: `0x${"11".repeat(32)}` as Hex,
  creator: vendorWallet,
  payload: { v: 1, name: "Halcyon Bridge", meta: vendorKeys.metaAddress, policy: "90 days", sla: 7, embargo: 90 } satisfies InboxPayload,
};
const watcherKeys = [scalar("w1"), scalar("w2"), scalar("w3")];
const watchers: WatcherRef[] = watcherKeys.map((k) => ({ address: privateKeyToAccount(k).address, pubkey: publicKeyOf(k) }));
const researcherSelfKey = scalar("researcher-self");
const caseKey = `0x${"cc".repeat(32)}` as Hex;
const clockKey = `0x${"dd".repeat(32)}` as Hex;

async function file() {
  return sealCase({
    report: {
      advisory: { title: "Replayable withdrawal proof", component: "bridge/verifier", severity: 4, summary: "s", researcher: "anon-7" },
      details: "full details",
      impact: "drain",
      reproduction: "steps",
      contact: "anon-7",
    },
    advisory: { title: "Replayable withdrawal proof", component: "bridge/verifier", severity: 4, cwe: "CWE-294", summary: "A withdrawal proof can be replayed.", researcher: "anon-7" },
    poc: "exploit code that never leaves the researcher",
    inbox,
    watchers,
    k: 2,
    researcherSelfKey,
    caseKey,
    clockKey,
    deadlineBlock: 1000n,
    deadlineAt: 1_760_000_000,
  });
}

describe("filing and opening a case", () => {
  it("puts no plaintext and no vendor identity in the public payload", async () => {
    const sealed = await file();
    const pub = JSON.stringify(sealed.payload).toLowerCase();
    for (const secret of ["halcyon", "replayable", "bridge/verifier", "exploit code", inbox.key.slice(2, 20), vendorWallet.slice(2).toLowerCase()]) {
      expect(pub).not.toContain(secret.toLowerCase());
    }
  });

  it("only the addressed vendor finds and reads it, and can act as the responder", async () => {
    const sealed = await file();
    const m = openForVendor(caseKey, sealed.payload, vendorKeys);
    expect(m?.report.details).toBe("full details");
    expect(m?.report.pocHash).toBe(sealed.payload.pocHash);
    expect(openForVendor(caseKey, sealed.payload, otherVendor)).toBeNull();
    const responderKey = stealthPrivateKey(vendorKeys.spendingPrivateKey, m!.hashedSharedSecret);
    expect(privateKeyToAccount(responderKey).address).toBe(sealed.payload.responder);
  });

  it("is bound to its case key: the same box under another key does not open", async () => {
    const sealed = await file();
    expect(() => openForVendor(`0x${"ee".repeat(32)}`, sealed.payload, vendorKeys)).toThrow();
  });

  it("the researcher keeps a readable copy, and vendor notes reach only the researcher", async () => {
    const sealed = await file();
    expect(openForResearcher(caseKey, sealed.payload, researcherSelfKey).impact).toBe("drain");
    const note = sealNote(caseKey, sealed.payload, "patch in review");
    expect(openNote(caseKey, note, researcherSelfKey)).toBe("patch in review");
    expect(() => openNote(caseKey, note, scalar("someone-else"))).toThrow();
  });
});

describe("lapse and reveal", () => {
  it("each watcher opens only its own share; any two rebuild the advisory key", async () => {
    const sealed = await file();
    const shares = sealed.triggers.map((t, i) => openShare(caseKey, t.payload, watchers[i]!.address, watcherKeys[i]!));
    expect(() => openShare(caseKey, sealed.triggers[0]!.payload, watchers[0]!.address, watcherKeys[1]!)).toThrow();
    const key = await reconstruct(caseKey, sealed.payload, [shares[0]!, shares[2]!]);
    expect(key).toBe(sealed.advisoryKey);
    expect(await reconstruct(caseKey, sealed.payload, [shares[1]!])).toBeNull();
  });

  it("a corrupted share from a misbehaving watcher cannot block the reveal", async () => {
    const sealed = await file();
    const shares = sealed.triggers.map((t, i) => openShare(caseKey, t.payload, watchers[i]!.address, watcherKeys[i]!));
    const bad = `${shares[0]!.slice(0, -2)}${shares[0]!.endsWith("00") ? "01" : "00"}` as Hex;
    expect(await reconstruct(caseKey, sealed.payload, [bad, shares[1]!, shares[2]!])).toBe(sealed.advisoryKey);
  });

  it("verifies the reveal end to end and names the vendor", async () => {
    const sealed = await file();
    const r = verifyRevealKey(caseKey, sealed.payload, sealed.advisoryKey, inbox);
    expect(r.ok).toBe(true);
    expect(r.checks).toEqual({ decrypts: true, commitment: true, responderBinding: true, inbox: true });
    expect(r.bundle?.name).toBe("Halcyon Bridge");
    expect(r.advisory?.cwe).toBe("CWE-294");
  });

  it("the reveal does not hand out the full report", async () => {
    const sealed = await file();
    const r = verifyRevealKey(caseKey, sealed.payload, sealed.advisoryKey, inbox);
    expect(JSON.stringify(r)).not.toContain("full details");
  });

  it("rejects a wrong key and a reveal that names a different vendor's inbox", async () => {
    const sealed = await file();
    expect(verifyRevealKey(caseKey, sealed.payload, `0x${"00".repeat(32)}`).ok).toBe(false);
    const impostorInbox = { creator: "0x9999999999999999999999999999999999999999" as Address, payload: inbox.payload };
    const r = verifyRevealKey(caseKey, sealed.payload, sealed.advisoryKey, impostorInbox);
    expect(r.ok).toBe(false);
    expect(r.checks.inbox).toBe(false);
  });
});
