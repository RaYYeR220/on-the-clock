// Pure derivation of a case's state from its entities. No network, no clocks: the same inputs give
// the same verdicts on every machine, which is what lets anyone re-check what the app shows.
//
// Trust comes from `$creator` alone. Attributes and payloads are claims; who wrote an entity is not.
import type { Address, Hex } from "viem";
import type { Kind, Outcome } from "./constants.js";
import { verifyRevealKey } from "./seal.js";
import type { CasePayload, GrantPayload, InboxPayload, OtcEntity, ReceiptPayload, RevealBundle, RevealPayload } from "./types.js";

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
  seconds?: number;
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
  extensions: { requested: number; granted: number; seconds: number };
  receipts: { valid: number; premature: Address[]; foreign: Address[]; withdrawn: number; conflicting: Address[] };
  shares: Hex[];
  reveal?: OtcEntity<RevealPayload>;
  /** A verified watcher-side reveal written before the deadline: evidence that k watchers colluded. */
  revealedEarly: boolean;
  /**
   * Whether the vendor the reveal names is the vendor that actually received the case. The name in
   * the bundle was written by the researcher; it only counts once the named inbox (created by the
   * named vendor, carrying the meta-address the case was addressed to) is checked.
   *   verified  - inbox found, creator and meta-address match
   *   mismatch  - inbox found and does not match: the bundle names the wrong vendor
   *   unknown   - inbox not available to check (deleted, or not supplied)
   *   null      - nothing revealed yet
   */
  attribution: "verified" | "mismatch" | "unknown" | null;
  /** Present only when attribution is verified. */
  vendor?: { name: string; address: Address; inbox: Hex };
  /**
   * How far a "verified" vendor act can be trusted. The responder address is written into the case by
   * the researcher, so until a reveal proves responder = P_spend + h·G for the vendor's key, a verified
   * ack only means "written by the address this case names as its responder" (a pseudonym the
   * researcher could, in principle, control). After a verified reveal it means "written by the vendor".
   *   null  - not yet bound (embargo running, or nothing revealed)
   *   true  - bound by a verified reveal
   */
  responderBound: true | null;
}

export interface DeriveInput {
  caseEntity: OtcEntity<CasePayload>;
  /** Every entity with `case = key(caseEntity)`. Order does not matter. */
  related: OtcEntity[];
  /** Inboxes available for checking who a reveal names (optional; without them attribution is "unknown"). */
  inboxes?: OtcEntity<InboxPayload>[];
  /**
   * The live clock, or null once it has lapsed or been deleted. Only the entity whose key the case
   * file committed to, written by the case's researcher, is accepted; anything else is treated as absent.
   */
  clock: OtcEntity | null;
  head: bigint;
}

const TIMELINE_KINDS: ReadonlySet<Kind> = new Set(["ack", "extreq", "fixed", "grant", "handoff", "receipt", "reveal"]);

const eqAddr = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0));

export function isCaseClock(caseEntity: OtcEntity<CasePayload>, e: OtcEntity | null | undefined): e is OtcEntity {
  return !!e && e.kind === "clock" && e.key.toLowerCase() === caseEntity.payload.clock.toLowerCase() && eqAddr(e.creator, caseEntity.creator);
}

export function deriveCase({ caseEntity, related, clock: candidate, head, inboxes }: DeriveInput): CaseView {
  const p = caseEntity.payload;
  const clock = isCaseClock(caseEntity, candidate) ? candidate : null;
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
  const extensions = { requested: 0, granted: 0, seconds: 0 };
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
        extensions.seconds += num(e.attrs.seconds);
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
  const receipts = { valid: 0, premature: [] as Address[], foreign: [] as Address[], withdrawn: 0, conflicting: [] as Address[] };
  const shares: Hex[] = [];
  const counted = new Set<string>();
  const withdrawnBy = new Set<string>();
  let reveal: OtcEntity<RevealPayload> | undefined;
  let revealBundle: RevealBundle | undefined;
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
        if (rp.outcome === "withdrawn") withdrawnBy.add(e.creator.toLowerCase());
      }
    } else if (e.kind === "reveal") {
      const rv = e as OtcEntity<RevealPayload>;
      if (rv.payload?.by === "researcher" && !eqAddr(e.creator, researcher)) {
        verdicts.set(e.key, { verdict: "ignored", reason: "claims to be the researcher's disclosure but is not" });
        continue;
      }
      // A reveal is trusted by recomputation, never by its author: the key must open this case's
      // advisory, open its vendor commitment, and bind its responder to the named vendor.
      const check = typeof rv.payload?.key === "string" ? verifyRevealKey(caseEntity.key, p, rv.payload.key) : null;
      if (!check || !check.checks.decrypts || !check.checks.commitment || !check.checks.delivery || !check.checks.responderBinding) {
        verdicts.set(e.key, { verdict: "ignored", reason: "its key does not open this case" });
        continue;
      }
      verdicts.set(e.key, { verdict: "verified" });
      if (rv.payload.by === "researcher") disclosedByResearcher = true;
      if (!reveal) {
        reveal = rv;
        revealBundle = check.bundle;
      }
    }
  }

  receipts.withdrawn = withdrawnBy.size;
  receipts.conflicting = watchers.filter((w) => counted.has(w.toLowerCase()) && withdrawnBy.has(w.toLowerCase()));

  // Order matters: k verified shares can never be outvoted by a watcher claiming withdrawal, and a
  // withdrawal needs the same threshold of watchers (or a clock gone before its deadline) to stand.
  let status: CaseStatus;
  if (live) {
    status = fixedAt !== undefined ? "fixed" : ackedAt !== undefined ? "acknowledged" : "sealed";
  } else if (disclosedByResearcher) {
    status = "disclosed";
  } else if (reveal) {
    status = "revealed";
  } else if (receipts.valid >= p.k) {
    status = "revealable";
  } else if (head < expectedExpiry || receipts.withdrawn >= p.k) {
    status = "withdrawn";
  } else {
    status = "lapsed";
  }

  const timeline: TimelineItem[] = [
    { key: caseEntity.key, kind: "case", by: researcher, block: caseEntity.createdAt, verdict: "verified" },
    ...items.map((e) => {
      const v = verdicts.get(e.key) ?? { verdict: "verified" as Verdict };
      const item: TimelineItem = { key: e.key, kind: e.kind, by: e.creator, block: e.createdAt, ...v };
      if (e.attrs.seconds !== undefined) item.seconds = num(e.attrs.seconds);
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
    revealedEarly: !!reveal && reveal.payload.by === "watchers" && reveal.createdAt < expectedExpiry,
    ...attribute(reveal, revealBundle, inboxes),
    // A reveal only counts after its key passed the responder-binding check above.
    responderBound: reveal ? true : null,
  };
}

function attribute(
  reveal: OtcEntity<RevealPayload> | undefined,
  bundle: RevealBundle | undefined,
  inboxes: OtcEntity<InboxPayload>[] | undefined,
): Pick<CaseView, "attribution" | "vendor"> {
  if (!reveal || !bundle) return { attribution: null };
  const inbox = inboxes?.find((i) => i.key.toLowerCase() === bundle.inbox.toLowerCase());
  if (!inbox) return { attribution: "unknown" };
  const ok = eqAddr(inbox.creator, bundle.vendor) && inbox.payload?.meta === bundle.meta;
  if (!ok) return { attribution: "mismatch" };
  return { attribution: "verified", vendor: { name: inbox.payload.name, address: inbox.creator, inbox: inbox.key } };
}
