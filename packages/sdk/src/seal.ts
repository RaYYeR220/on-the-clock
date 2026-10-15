// Assembling and opening a case. Pure crypto, no network: everything here is unit-tested.
import { keccak256, type Address, type Hex } from "viem";
import { bytesToHex, hexToBytes } from "viem/utils";
import {
  concat,
  deriveKey,
  eciesDecrypt,
  eciesEncrypt,
  open,
  publicKeyOf,
  randomBytes,
  seal,
  sha256Hex,
  type EciesBox,
} from "./crypto/box.js";
import { combineShares, splitKey } from "./crypto/shamir.js";
import {
  checkStealth,
  generateStealthAddress,
  parseMetaAddress,
  stealthAddressFromTweak,
  type StealthKeys,
} from "./crypto/stealth.js";
import type {
  Advisory,
  CasePayload,
  InboxPayload,
  Report,
  RevealBundle,
  SealedAdvisory,
  TriggerPayload,
  WatcherRef,
} from "./types.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (v: unknown) => enc.encode(JSON.stringify(v));
const REPORT_INFO = "on-the-clock/report/v1";

export interface SealCaseInput {
  report: Omit<Report, "pocHash">;
  advisory: Advisory;
  /** The proof of concept. Only its hash leaves this function. */
  poc: string | Uint8Array;
  inbox: { key: Hex; creator: Address; payload: InboxPayload };
  watchers: WatcherRef[];
  k: number;
  researcherSelfKey: Hex;
  caseKey: Hex;
  clockKey: Hex;
  deadlineBlock: bigint;
  deadlineAt: number;
}

export interface SealedCase {
  payload: CasePayload;
  triggers: { watcher: WatcherRef; payload: TriggerPayload }[];
  responder: Address;
  /** Kept by the researcher for early disclosure; never written anywhere in plaintext before a reveal. */
  advisoryKey: Hex;
}

/**
 * A share is bound to its case, its clock and its watcher. Copying the ciphertext into a trigger that
 * points at a different clock (one that lapses sooner) makes it undecryptable.
 */
export function shareAad(caseKey: Hex, clockKey: Hex, watcher: Address): Uint8Array {
  return concat(hexToBytes(caseKey), hexToBytes(clockKey), hexToBytes(watcher));
}

export function vendorCommitment(inboxKey: Hex, salt: Hex): Hex {
  return keccak256(concat(hexToBytes(inboxKey), hexToBytes(salt)));
}

export async function sealCase(input: SealCaseInput): Promise<SealedCase> {
  const { caseKey } = input;
  const aad = hexToBytes(caseKey);
  if (input.watchers.length < input.k) throw new Error("fewer watchers than the threshold");

  const stealth = generateStealthAddress(input.inbox.payload.meta);
  const pocHash = sha256Hex(input.poc);
  const report: Report = { ...input.report, pocHash };
  const reportBytes = json(report);

  const vendorKey = deriveKey(stealth.sharedSecret, REPORT_INFO, aad);
  const vendorBox = seal(vendorKey, reportBytes, aad);
  const selfBox = eciesEncrypt(publicKeyOf(input.researcherSelfKey), reportBytes, aad);

  const salt = bytesToHex(randomBytes(32));
  const bundle: RevealBundle = {
    inbox: input.inbox.key,
    vendor: input.inbox.creator,
    name: input.inbox.payload.name,
    salt,
    h: stealth.hashedSharedSecret,
    meta: input.inbox.payload.meta,
  };
  const K = randomBytes(32);
  const sealedAdvisory: SealedAdvisory = { advisory: input.advisory, bundle };
  const advisoryBox = seal(K, json(sealedAdvisory), aad);

  const shares = await splitKey(K, input.watchers.length, input.k);
  const triggers = input.watchers.map((watcher, i) => ({
    watcher,
    payload: {
      v: 1 as const,
      box: eciesEncrypt(watcher.pubkey, hexToBytes(shares[i]!), shareAad(caseKey, input.clockKey, watcher.address)),
    },
  }));

  return {
    responder: stealth.stealthAddress,
    advisoryKey: bytesToHex(K),
    triggers,
    payload: {
      v: 1,
      eph: stealth.ephemeralPublicKey,
      vt: stealth.viewTag,
      responder: stealth.stealthAddress,
      vcommit: vendorCommitment(input.inbox.key, salt),
      vendorBox,
      selfBox,
      researcherKey: publicKeyOf(input.researcherSelfKey),
      advisoryBox,
      reportHash: sha256Hex(reportBytes),
      pocHash,
      watchers: input.watchers,
      k: input.k,
      clock: input.clockKey,
      deadlineBlock: input.deadlineBlock.toString(),
      deadlineAt: input.deadlineAt,
    },
  };
}

// ---------- vendor side ----------

export interface VendorMatch {
  responder: Address;
  hashedSharedSecret: Hex;
  report: Report;
}

/** Tries a case against a vendor's keys. Null unless the case is addressed to this vendor. */
export function openForVendor(caseKey: Hex, payload: CasePayload, keys: StealthKeys): VendorMatch | null {
  const m = checkStealth(payload.eph, payload.vt, keys);
  if (!m || m.stealthAddress.toLowerCase() !== payload.responder.toLowerCase()) return null;
  const aad = hexToBytes(caseKey);
  const bytes = open(deriveKey(m.sharedSecret, REPORT_INFO, aad), payload.vendorBox, aad);
  if (sha256Hex(bytes) !== payload.reportHash) throw new Error("report does not match its committed hash");
  return { responder: m.stealthAddress, hashedSharedSecret: m.hashedSharedSecret, report: JSON.parse(dec.decode(bytes)) as Report };
}

export function openForResearcher(caseKey: Hex, payload: CasePayload, selfKey: Hex): Report {
  const bytes = eciesDecrypt(selfKey, payload.selfBox, hexToBytes(caseKey));
  return JSON.parse(dec.decode(bytes)) as Report;
}

export function sealNote(caseKey: Hex, payload: CasePayload, note: string): EciesBox {
  return eciesEncrypt(payload.researcherKey, enc.encode(note), hexToBytes(caseKey));
}

export function openNote(caseKey: Hex, box: EciesBox, selfKey: Hex): string {
  return dec.decode(eciesDecrypt(selfKey, box, hexToBytes(caseKey)));
}

// ---------- watcher side ----------

export function openShare(caseKey: Hex, clockKey: Hex, trigger: TriggerPayload, watcher: Address, watcherKey: Hex): Hex {
  return bytesToHex(eciesDecrypt(watcherKey, trigger.box, shareAad(caseKey, clockKey, watcher)));
}

// ---------- reveal ----------

export interface RevealChecks {
  /** K decrypts the advisory sealed at filing time. */
  decrypts: boolean;
  /** The bundle opens the vendor commitment written at filing time. */
  commitment: boolean;
  /** The responder that acted on the case derives from this vendor's spending key. */
  responderBinding: boolean;
  /** The named inbox was created by the named vendor and carries the same meta-address. */
  inbox: boolean | null;
}

export interface RevealResult {
  ok: boolean;
  checks: RevealChecks;
  advisory?: Advisory;
  bundle?: RevealBundle;
  key?: Hex;
}

export function verifyRevealKey(
  caseKey: Hex,
  payload: CasePayload,
  key: Hex,
  inbox?: { creator: Address; payload: InboxPayload } | null,
): RevealResult {
  const checks: RevealChecks = { decrypts: false, commitment: false, responderBinding: false, inbox: null };
  let sealed: SealedAdvisory;
  try {
    sealed = JSON.parse(dec.decode(open(hexToBytes(key), payload.advisoryBox, hexToBytes(caseKey)))) as SealedAdvisory;
    checks.decrypts = true;
  } catch {
    return { ok: false, checks };
  }
  const b = sealed.bundle;
  checks.commitment = vendorCommitment(b.inbox, b.salt) === payload.vcommit;
  try {
    const { spendingPublicKey } = parseMetaAddress(b.meta);
    checks.responderBinding = stealthAddressFromTweak(spendingPublicKey, b.h).toLowerCase() === payload.responder.toLowerCase();
  } catch {
    checks.responderBinding = false;
  }
  if (inbox) {
    checks.inbox = inbox.creator.toLowerCase() === b.vendor.toLowerCase() && inbox.payload.meta === b.meta;
  }
  const ok = checks.decrypts && checks.commitment && checks.responderBinding && checks.inbox !== false;
  return { ok, checks, advisory: sealed.advisory, bundle: b, key };
}

/**
 * Rebuilds K from published shares. With more than k shares it tries k-subsets, so one bad share
 * from a misbehaving watcher cannot block the reveal.
 */
export async function reconstruct(caseKey: Hex, payload: CasePayload, shares: Hex[]): Promise<Hex | null> {
  const unique = [...new Set(shares.map((s) => s.toLowerCase() as Hex))];
  if (unique.length < payload.k) return null;
  for (const subset of combinations(unique, payload.k)) {
    let key: Hex;
    try {
      key = bytesToHex(await combineShares(subset));
    } catch {
      continue;
    }
    if (verifyRevealKey(caseKey, payload, key).checks.decrypts) return key;
  }
  return null;
}

function* combinations<T>(items: T[], size: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === size) {
    yield [...acc];
    return;
  }
  for (let i = start; i < items.length; i++) {
    acc.push(items[i]!);
    yield* combinations(items, size, i + 1, acc);
    acc.pop();
  }
}
