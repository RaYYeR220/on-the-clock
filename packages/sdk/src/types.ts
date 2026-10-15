import type { Address, Hex } from "viem";
import type { Kind, Outcome, Severity } from "./constants.js";
import type { EciesBox } from "./crypto/box.js";
import type { MetaAddress } from "./crypto/stealth.js";

/** The public, verifiable shape of any On the Clock entity after decoding. */
export interface OtcEntity<P = unknown> {
  key: Hex;
  kind: Kind;
  creator: Address;
  owner: Address;
  createdAt: bigint;
  expiresAt: bigint;
  readonly: boolean;
  permissionlessExtension: boolean;
  attrs: Record<string, string | bigint | boolean>;
  payload: P;
  /** Bytes of the raw payload, as an outside reader sees it. */
  payloadBytes: number;
}

// ---------- payloads (JSON, versioned) ----------

export interface InboxPayload {
  v: 1;
  name: string;
  meta: MetaAddress;
  policy: string;
  sla: number;
  embargo: number;
  contact?: string;
}

export interface WatcherRef {
  address: Address;
  /** Compressed secp256k1 key the watcher decrypts its share with. */
  pubkey: Hex;
}

export interface CasePayload {
  v: 1;
  /** ERC-5564 ephemeral public key and view tag: how the vendor finds the case. */
  eph: Hex;
  vt: number;
  /** One-time stealth address the vendor answers from. */
  responder: Address;
  /** keccak(inboxKey ‖ salt): binds the case to one vendor without naming it. */
  vcommit: Hex;
  /** Full report for the vendor, sealed under HKDF(shared secret). Never auto-released. */
  vendorBox: Hex;
  /** The researcher's own copy. */
  selfBox: EciesBox;
  /** Researcher encryption key, so vendor notes can be sealed to it. */
  researcherKey: Hex;
  /** Advisory + reveal bundle, sealed under K. K is split k-of-n across the watchers. */
  advisoryBox: Hex;
  reportHash: Hex;
  /** The proof of concept never touches Arkiv; only its hash does. */
  pocHash: Hex;
  watchers: WatcherRef[];
  k: number;
  clock: Hex;
  /** Deadline as filed, in blocks and unix seconds (informational: the clock's expiry is authoritative). */
  deadlineBlock: string;
  deadlineAt: number;
}

export interface TriggerPayload {
  v: 1;
  box: EciesBox;
}

export interface VendorActPayload {
  v: 1;
  /** Optional note sealed to the researcher. */
  note?: EciesBox;
}

export interface GrantPayload {
  v: 1;
  /** The clock's new expiry block. */
  expiresAt: string;
  request?: Hex;
}

export interface HandoffPayload {
  v: 1;
  reason?: string;
}

export interface WatcherPayload {
  v: 1;
  pubkey: Hex;
  operator: string;
  version: string;
}

export interface ReceiptPayload {
  v: 1;
  outcome: Outcome;
  /** The watcher's plaintext share, published only for `lapsed`. */
  share?: Hex;
  observed: {
    head: string;
    expiresAt: string;
    /** Block at which the clock was last seen alive (historical query). */
    aliveAt?: string;
  };
}

export interface RevealPayload {
  v: 1;
  /** The advisory key K. Anyone can check it against the case before trusting it. */
  key: Hex;
  by: "watchers" | "researcher";
}

// ---------- sealed contents ----------

export interface Advisory {
  title: string;
  component: string;
  severity: Severity;
  cwe?: string;
  summary: string;
  researcher: string;
}

/** What turns "a stealth address acknowledged" into "this vendor acknowledged", at reveal time. */
export interface RevealBundle {
  inbox: Hex;
  vendor: Address;
  name: string;
  salt: Hex;
  /** keccak(shared secret). Proves responder = P_spend + h·G without exposing the report key. */
  h: Hex;
  meta: MetaAddress;
}

export interface SealedAdvisory {
  advisory: Advisory;
  bundle: RevealBundle;
}

export interface Report {
  advisory: Advisory;
  details: string;
  impact: string;
  reproduction: string;
  pocHash: Hex;
  contact: string;
}
