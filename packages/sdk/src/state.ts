// Pure derivation of a case's state from its entities. No network, no clocks: the same inputs give
// the same verdicts on every machine, which is what lets anyone re-check what the app shows.
//
// Trust comes from `$creator` alone. Attributes and payloads are claims; who wrote an entity is not.
import type { Address, Hex } from "viem";
import type { Kind, Outcome } from "./constants.js";
import type { CasePayload, GrantPayload, OtcEntity, ReceiptPayload, RevealPayload } from "./types.js";

export type CaseStatus =
  | "sealed"
  | "acknowledged"
  | "fixed"
  | "lapsed"
  | "revealable"
  | "revealed"
  | "disclosed"
  | "withdrawn";

export type Verdict = "verified" | "ignored" | "premature";

export interface TimelineItem {
  key: Hex;
  kind: Kind;
  by: Address;
  block: bigint;
  verdict: Verdict;
  reason?: string;
  days?: number;
  outcome?: Outcome;
  to?: Address;
}

export interface CaseView {
  key: Hex;
  sev: number;
  researcher: Address;
  responder: Address;
  k: number;
  n: number;
  watchers: Address[];
  clock: { key: Hex; live: boolean; owner: Address | null; expiresAt: bigint };
  /** The deadline the records support: the filing deadline, moved only by verified grants. */
  expectedExpiry: bigint;
  /** True when the live clock runs later than any verified grant explains. */
  unrecordedExtension: boolean;
  blocksLeft: bigint;
  custodian: Address;
  status: CaseStatus;
  timeline: TimelineItem[];
  ignored: TimelineItem[];
  ackedAt?: bigint;
  fixedAt?: bigint;
  extensions: { requested: number; granted: number; days: number };
  receipts: { valid: number; premature: Address[]; foreign: Address[]; withdrawn: number };
  shares: Hex[];
  reveal?: OtcEntity<RevealPayload>;
}

export interface DeriveInput {
  caseEntity: OtcEntity<CasePayload>;
  /** Every entity with `case = key(caseEntity)`. Order does not matter. */
  related: OtcEntity[];
  /** The live clock, or null once it has lapsed or been deleted. */
  clock: OtcEntity | null;
  head: bigint;
}

const TIMELINE_KINDS: ReadonlySet<Kind> = new Set(["ack", "extreq", "fixed", "grant", "handoff", "receipt", "reveal"]);

const eqAddr = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0));

export function deriveCase({ caseEntity, related, clock, head }: DeriveInput): CaseView {
  const p = caseEntity.payload;
  const researcher = caseEntity.creator;
  const responder = p.responder;
  const watchers = p.watchers.map((w) => w.address);
  const isWatcher = (a: Address) => watchers.some((w) => eqAddr(w, a));

  const items = [...related]
    .filter((e) => TIMELINE_KINDS.has(e.kind))
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.key < b.key ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));

  // Pass 1: custody chain and the deadline it supports.
  let custodian: Address = researcher;
  let expectedExpiry = BigInt(p.deadlineBlock);
  const verdicts = new Map<Hex, { verdict: Verdict; reason?: string }>();
  const extensions = { requested: 0, granted: 0, days: 0 };
  let ackedAt: bigint | undefined;
  let fixedAt: bigint | undefined;

  for (const e of items) {
    switch (e.kind) {
      case "ack":
      case "extreq":
      case "fixed": {
        if (!eqAddr(e.creator, responder)) {
          verdicts.set(e.key, { verdict: "ignored", reason: "not written by this case's responder" });
          break;
        }
        verdicts.set(e.key, { verdict: "verified" });
        if (e.kind === "ack") ackedAt ??= e.createdAt;
        if (e.kind === "fixed") fixedAt ??= e.createdAt;
        if (e.kind === "extreq") extensions.requested++;
        break;
      }
      case "grant": {
        if (!eqAddr(e.creator, custodian)) {
          verdicts.set(e.key, { verdict: "ignored", reason: "not written by the clock's custodian at the time" });
          break;
        }
        verdicts.set(e.key, { verdict: "verified" });
        extensions.granted++;
        extensions.days += num(e.attrs.days);
        const to = BigInt((e.payload as GrantPayload).expiresAt ?? 0);
        if (to > expectedExpiry) expectedExpiry = to;
        break;
      }
      case "handoff": {
        if (!eqAddr(e.creator, custodian)) {
          verdicts.set(e.key, { verdict: "ignored", reason: "not written by the clock's custodian at the time" });
          break;
        }
        verdicts.set(e.key, { verdict: "verified" });
        custodian = e.attrs.to as Address;
        break;
      }
      default:
        break;
    }
  }

  const live = clock !== null;
  const clockExpiry = clock ? clock.expiresAt : expectedExpiry;
  const unrecordedExtension = live && clockExpiry > expectedExpiry;

  // Pass 2: receipts and reveals, judged against the deadline the records support.
  const receipts = { valid: 0, premature: [] as Address[], foreign: [] as Address[], withdrawn: 0 };
  const shares: Hex[] = [];
  const counted = new Set<string>();
  let reveal: OtcEntity<RevealPayload> | undefined;
  let disclosedByResearcher = false;

  for (const e of items) {
    if (e.kind === "receipt") {
      const rp = e.payload as ReceiptPayload;
      if (!isWatcher(e.creator)) {
        receipts.foreign.push(e.creator);
        verdicts.set(e.key, { verdict: "ignored", reason: "not one of this case's watchers" });
        continue;
      }
      if (rp.outcome === "lapsed") {
        if (e.createdAt < expectedExpiry) {
          receipts.premature.push(e.creator);
          verdicts.set(e.key, { verdict: "premature", reason: "published before the deadline the records support" });
          continue;
        }
        verdicts.set(e.key, { verdict: "verified" });
        const who = e.creator.toLowerCase();
        if (!counted.has(who) && rp.share) {
          counted.add(who);
          receipts.valid++;
          shares.push(rp.share);
        }
      } else {
        verdicts.set(e.key, { verdict: "verified" });
        if (rp.outcome === "withdrawn") receipts.withdrawn++;
      }
    } else if (e.kind === "reveal") {
      const rv = e as OtcEntity<RevealPayload>;
      if (rv.payload.by === "researcher") {
        if (!eqAddr(e.creator, researcher)) {
          verdicts.set(e.key, { verdict: "ignored", reason: "claims to be the researcher's disclosure but is not" });
          continue;
        }
        disclosedByResearcher = true;
      }
      // A watcher-side reveal is trusted by recomputation, not by its author: see verifyReveal().
      verdicts.set(e.key, { verdict: "verified" });
      reveal ??= rv;
    }
  }

  let status: CaseStatus;
  if (live) {
    status = fixedAt !== undefined ? "fixed" : ackedAt !== undefined ? "acknowledged" : "sealed";
  } else if (disclosedByResearcher) {
    status = "disclosed";
  } else if (reveal) {
    status = "revealed";
  } else if (receipts.withdrawn > 0 || head < expectedExpiry) {
    status = "withdrawn";
  } else if (receipts.valid >= p.k) {
    status = "revealable";
  } else {
    status = "lapsed";
  }

  const timeline: TimelineItem[] = [
    { key: caseEntity.key, kind: "case", by: researcher, block: caseEntity.createdAt, verdict: "verified" },
    ...items.map((e) => {
      const v = verdicts.get(e.key) ?? { verdict: "verified" as Verdict };
      const item: TimelineItem = { key: e.key, kind: e.kind, by: e.creator, block: e.createdAt, ...v };
      if (e.attrs.days !== undefined) item.days = num(e.attrs.days);
      if (e.kind === "receipt") item.outcome = (e.payload as ReceiptPayload).outcome;
      if (e.kind === "handoff") item.to = e.attrs.to as Address;
      return item;
    }),
  ];

  return {
    key: caseEntity.key,
    sev: num(caseEntity.attrs.sev),
    researcher,
    responder,
    k: p.k,
    n: watchers.length,
    watchers,
    clock: { key: p.clock, live, owner: clock?.owner ?? null, expiresAt: clockExpiry },
    expectedExpiry,
    unrecordedExtension,
    blocksLeft: live && clockExpiry > head ? clockExpiry - head : 0n,
    custodian,
    status,
    timeline,
    ignored: timeline.filter((t) => t.verdict !== "verified"),
    ...(ackedAt !== undefined ? { ackedAt } : {}),
    ...(fixedAt !== undefined ? { fixedAt } : {}),
    extensions,
    receipts,
    shares,
    ...(reveal ? { reveal } : {}),
  };
}
