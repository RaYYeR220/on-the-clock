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
import { deriveCase } from "../src/state.js";
import type { CasePayload, InboxPayload, OtcEntity, WatcherRef } from "../src/types.js";

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
    const shares = sealed.triggers.map((t, i) => openShare(caseKey, clockKey, t.payload, watchers[i]!.address, watcherKeys[i]!));
    expect(() => openShare(caseKey, clockKey, sealed.triggers[0]!.payload, watchers[0]!.address, watcherKeys[1]!)).toThrow();
    // The same ciphertext copied into a trigger aimed at another (sooner) clock does not open.
    expect(() => openShare(caseKey, `0x${"ef".repeat(32)}`, sealed.triggers[0]!.payload, watchers[0]!.address, watcherKeys[0]!)).toThrow();
    const key = await reconstruct(caseKey, sealed.payload, [shares[0]!, shares[2]!]);
    expect(key).toBe(sealed.advisoryKey);
    expect(await reconstruct(caseKey, sealed.payload, [shares[1]!])).toBeNull();
  });

  it("a corrupted share from a misbehaving watcher cannot block the reveal", async () => {
    const sealed = await file();
    const shares = sealed.triggers.map((t, i) => openShare(caseKey, clockKey, t.payload, watchers[i]!.address, watcherKeys[i]!));
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

describe("reveals inside the case state", () => {
  const asEntity = <P>(kind: OtcEntity["kind"], creator: Address, createdAt: bigint, payload: P, attrs: Record<string, string> = {}, key = `0x${Math.random().toString(16).slice(2).padEnd(64, "0")}` as Hex): OtcEntity<P> => ({
    key, kind, creator, owner: creator, createdAt, expiresAt: createdAt + 10_000n, readonly: true, permissionlessExtension: true,
    attrs: { app: "onclock", kind, case: caseKey, ...attrs }, payload, payloadBytes: 1,
  });
  const researcher = privateKeyToAccount(researcherSelfKey).address;

  it("a verified watcher reveal makes the case revealed; a bogus one cannot block it", async () => {
    const sealed = await file();
    const caseEntity = asEntity<CasePayload>("case", researcher, 100n, sealed.payload, {}, caseKey);
    const bogus = asEntity("reveal", "0x9999999999999999999999999999999999999999", 1001n, { v: 1, key: `0x${"ab".repeat(32)}`, by: "watchers" });
    const real = asEntity("reveal", watchers[0]!.address, 1002n, { v: 1, key: sealed.advisoryKey, by: "watchers" });
    const before = deriveCase({ caseEntity, related: [bogus], clock: null, head: 1100n });
    expect(before.status).toBe("lapsed");
    const after = deriveCase({ caseEntity, related: [bogus, real], clock: null, head: 1100n });
    expect(after.status).toBe("revealed");
    expect(after.reveal?.key).toBe(real.key);
  });

  it("early disclosure counts only from the researcher, and only with the real key", async () => {
    const sealed = await file();
    const caseEntity = asEntity<CasePayload>("case", researcher, 100n, sealed.payload, {}, caseKey);
    const impostor = asEntity("reveal", watchers[1]!.address, 500n, { v: 1, key: sealed.advisoryKey, by: "researcher" });
    expect(deriveCase({ caseEntity, related: [impostor], clock: null, head: 600n }).status).toBe("withdrawn");
    const mine = asEntity("reveal", researcher, 500n, { v: 1, key: sealed.advisoryKey, by: "researcher" });
    expect(deriveCase({ caseEntity, related: [mine], clock: null, head: 600n }).status).toBe("disclosed");
  });
});

describe("who a reveal names", () => {
  const researcher = privateKeyToAccount(researcherSelfKey).address;
  const asInbox = (k: Hex, creator: Address, payload: InboxPayload): OtcEntity<InboxPayload> => ({
    key: k, kind: "inbox", creator, owner: creator, createdAt: 50n, expiresAt: 99_999n, readonly: true, permissionlessExtension: true,
    attrs: { app: "onclock", kind: "inbox" }, payload, payloadBytes: 1,
  });
  const caseOf = (payload: CasePayload): OtcEntity<CasePayload> => ({
    key: caseKey, kind: "case", creator: researcher, owner: researcher, createdAt: 100n, expiresAt: 99_999n, readonly: true, permissionlessExtension: true,
    attrs: { app: "onclock", kind: "case", sev: 4n }, payload, payloadBytes: 1,
  });
  const revealOf = (k: Hex): OtcEntity => ({
    key: `0x${"77".repeat(32)}`, kind: "reveal", creator: watchers[0]!.address, owner: watchers[0]!.address, createdAt: 1001n, expiresAt: 99_999n,
    readonly: true, permissionlessExtension: true, attrs: { app: "onclock", kind: "reveal", case: caseKey }, payload: { v: 1, key: k, by: "watchers" }, payloadBytes: 1,
  });

  it("names the vendor only once its inbox checks out", async () => {
    const sealed = await file();
    const base = { caseEntity: caseOf(sealed.payload), related: [revealOf(sealed.advisoryKey)], clock: null, head: 1100n };
    expect(deriveCase(base).attribution).toBe("unknown");
    const v = deriveCase({ ...base, inboxes: [asInbox(inbox.key, inbox.creator, inbox.payload)] });
    expect(v.attribution).toBe("verified");
    expect(v.vendor?.name).toBe("Halcyon Bridge");
  });

  it("a researcher who pins the case on someone else's inbox is caught", async () => {
    // Addressed to Halcyon's keys, but the bundle names an innocent vendor's inbox.
    const innocent = { key: `0x${"22".repeat(32)}` as Hex, creator: "0x8888888888888888888888888888888888888888" as Address, payload: { ...inbox.payload, name: "Innocent Labs", meta: otherVendor.metaAddress } };
    const sealed = await sealCase({
      report: { advisory: { title: "t", component: "c", severity: 3, summary: "s", researcher: "r" }, details: "d", impact: "i", reproduction: "r", contact: "c" },
      advisory: { title: "t", component: "c", severity: 3, summary: "s", researcher: "r" },
      poc: "p",
      inbox: { key: innocent.key, creator: innocent.creator, payload: { ...innocent.payload, meta: vendorKeys.metaAddress } },
      watchers, k: 2, researcherSelfKey, caseKey, clockKey, deadlineBlock: 1000n, deadlineAt: 0,
    });
    const v = deriveCase({
      caseEntity: caseOf(sealed.payload),
      related: [revealOf(sealed.advisoryKey)],
      clock: null,
      head: 1100n,
      inboxes: [asInbox(innocent.key, innocent.creator, innocent.payload)],
    });
    expect(v.status).toBe("revealed");
    expect(v.attribution).toBe("mismatch");
    expect(v.vendor).toBeUndefined();
  });
});
