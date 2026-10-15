// Every read the app makes. Each one is a single Arkiv query (plus cursor pages), written out in
// /arkiv/schema.md so anyone can run it without our backend.
import { NoEntityFoundError, type PublicArkivClient } from "@arkiv-network/sdk";
import { addr, key, str, u64 } from "@arkiv-network/sdk/attr";
import { and, eq, lte, or, type Expression } from "@arkiv-network/sdk/query";
import type { Address, Hex } from "viem";
import { APP, type Kind } from "./constants.js";
import { decodeEntity } from "./codec.js";
import type { StealthKeys } from "./crypto/stealth.js";
import { openForVendor, verifyRevealKey, reconstruct, type RevealResult, type VendorMatch } from "./seal.js";
import { deriveCase, isCaseClock, type CaseView } from "./state.js";
import type { CasePayload, InboxPayload, OtcEntity, RevealPayload, WatcherPayload } from "./types.js";

export const app = () => eq("app", str(APP));
export const kindIs = (k: Kind) => eq("kind", str(k));

export interface FetchOptions {
  atBlock?: bigint;
  /** Stop after this many pages (200 entities each). */
  maxPages?: number;
  createdBy?: Address;
  ownedBy?: Address;
}

/** Walks every page of a query. Results come back newest-first; Arkiv has no server-side ordering. */
export async function fetchAll<P = unknown>(pub: PublicArkivClient, where: Expression[], opts: FetchOptions = {}): Promise<OtcEntity<P>[]> {
  let q = pub.select("*").where(...where).limit(200);
  if (opts.createdBy) q = q.createdBy(opts.createdBy);
  if (opts.ownedBy) q = q.ownedBy(opts.ownedBy);
  if (opts.atBlock !== undefined) q = q.atBlock(opts.atBlock);
  const out: OtcEntity<P>[] = [];
  let page = await q.fetch();
  let pages = 1;
  for (;;) {
    for (const e of page.entities) {
      const d = decodeEntity<P>(e);
      if (d) out.push(d);
    }
    if (!page.hasNextPage() || pages >= (opts.maxPages ?? 50)) break;
    page = await page.next();
    pages++;
  }
  return out;
}

export async function getOne<P = unknown>(pub: PublicArkivClient, entityKey: Hex): Promise<OtcEntity<P> | null> {
  try {
    return decodeEntity<P>(await pub.getEntity(entityKey));
  } catch (e) {
    if (e instanceof NoEntityFoundError) return null;
    throw e;
  }
}

// ---------- cases ----------

export interface CaseBundle {
  view: CaseView;
  caseEntity: OtcEntity<CasePayload>;
  related: OtcEntity[];
  clock: OtcEntity | null;
  head: bigint;
}

export async function loadCase(pub: PublicArkivClient, caseKey: Hex): Promise<CaseBundle | null> {
  // One query returns the case file and everything that points at it.
  const [all, head] = await Promise.all([
    fetchAll(pub, [app(), or(eq("$key", key(caseKey)), eq("case", key(caseKey)))]),
    pub.getBlockNumber(),
  ]);
  const caseEntity = all.find((e) => e.kind === "case" && e.key.toLowerCase() === caseKey.toLowerCase()) as OtcEntity<CasePayload> | undefined;
  if (!caseEntity) return null;
  // The clock is the entity the case file committed to, by the same author. Anything else that
  // calls itself a clock for this case is noise someone else wrote.
  const clock = all.find((e) => isCaseClock(caseEntity, e)) ?? null;
  const related = all.filter((e) => e !== caseEntity && e !== clock);
  return { view: deriveCase({ caseEntity, related, clock, head }), caseEntity, related, clock, head };
}

export interface Board {
  head: bigint;
  cases: CaseBundle[];
  inboxes: OtcEntity<InboxPayload>[];
  watchers: OtcEntity<WatcherPayload>[];
}

/** Everything the protocol has written, grouped by case. One query, walked page by page. */
export async function loadBoard(pub: PublicArkivClient): Promise<Board> {
  const [all, head] = await Promise.all([fetchAll(pub, [app()]), pub.getBlockNumber()]);
  const byCase = new Map<string, OtcEntity[]>();
  for (const e of all) {
    const c = e.attrs.case;
    if (typeof c === "string") {
      const k = c.toLowerCase();
      byCase.set(k, [...(byCase.get(k) ?? []), e]);
    }
  }
  const cases: CaseBundle[] = [];
  for (const e of all) {
    if (e.kind !== "case") continue;
    const caseEntity = e as OtcEntity<CasePayload>;
    const rel = byCase.get(e.key.toLowerCase()) ?? [];
    const clock = rel.find((r) => isCaseClock(caseEntity, r)) ?? null;
    const related = rel.filter((r) => r !== clock);
    cases.push({ view: deriveCase({ caseEntity, related, clock, head }), caseEntity, related, clock, head });
  }
  return {
    head,
    cases,
    inboxes: all.filter((e) => e.kind === "inbox") as OtcEntity<InboxPayload>[],
    watchers: dedupeByCreator(all.filter((e) => e.kind === "watcher") as OtcEntity<WatcherPayload>[]),
  };
}

function dedupeByCreator<T extends OtcEntity>(list: T[]): T[] {
  const seen = new Map<string, T>();
  for (const e of list) {
    const k = e.creator.toLowerCase();
    const prev = seen.get(k);
    if (!prev || e.expiresAt > prev.expiresAt) seen.set(k, e);
  }
  return [...seen.values()];
}

// ---------- inboxes, watchers ----------

export async function listInboxes(pub: PublicArkivClient): Promise<OtcEntity<InboxPayload>[]> {
  return fetchAll<InboxPayload>(pub, [app(), kindIs("inbox")]);
}

/** A watcher is alive exactly while its lease entity exists, so "alive" is just "present". */
export async function listWatchers(pub: PublicArkivClient): Promise<OtcEntity<WatcherPayload>[]> {
  return dedupeByCreator(await fetchAll<WatcherPayload>(pub, [app(), kindIs("watcher")]));
}

/** Triggers addressed to one watcher: its whole job list is one attribute match. */
export async function listTriggersFor(pub: PublicArkivClient, watcher: Address): Promise<OtcEntity[]> {
  return fetchAll(pub, [app(), kindIs("trigger"), eq("watcher", addr(watcher))]);
}

/** Clocks a custodian holds, soonest deadline first (sorted here: Arkiv has no ORDER BY). */
export async function listClocksHeldBy(pub: PublicArkivClient, custodian: Address): Promise<OtcEntity[]> {
  const list = await fetchAll(pub, [app(), kindIs("clock")], { ownedBy: custodian });
  return list.sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1));
}

/** Clocks running out within `blocks`. `$expiresAt` is a queryable block height. */
export async function listExpiringWithin(pub: PublicArkivClient, blocks: bigint): Promise<OtcEntity[]> {
  const head = await pub.getBlockNumber();
  return fetchAll(pub, [app(), kindIs("clock"), lte("$expiresAt", u64(head + blocks))]);
}

// ---------- vendor ----------

export interface InboxCase {
  caseEntity: OtcEntity<CasePayload>;
  match: VendorMatch;
}

/** Trial-decrypts every case against a vendor's keys. Only the vendor can tell which are theirs. */
export function scanForVendor(cases: OtcEntity<CasePayload>[], keys: StealthKeys): InboxCase[] {
  const out: InboxCase[] = [];
  for (const c of cases) {
    try {
      const match = openForVendor(c.key, c.payload, keys);
      if (match) out.push({ caseEntity: c, match });
    } catch {
      // A case that matches the view tag but fails to open was not for us.
    }
  }
  return out;
}

// ---------- reveal ----------

export async function resolveReveal(pub: PublicArkivClient, bundle: CaseBundle): Promise<RevealResult | null> {
  const { view, caseEntity } = bundle;
  let k: Hex | null = null;
  if (view.reveal) k = (view.reveal.payload as RevealPayload).key;
  if (!k && view.shares.length >= view.k) k = await reconstruct(caseEntity.key, caseEntity.payload, view.shares);
  if (!k) return null;
  const first = verifyRevealKey(caseEntity.key, caseEntity.payload, k);
  if (!first.bundle) return first;
  const inbox = await getOne<InboxPayload>(pub, first.bundle.inbox);
  return verifyRevealKey(caseEntity.key, caseEntity.payload, k, inbox);
}

/** Reveal entities naming a vendor. Each one is an index, re-verified before it counts. */
export async function listRevealsForVendor(pub: PublicArkivClient, vendor: Address): Promise<OtcEntity<RevealPayload>[]> {
  return fetchAll<RevealPayload>(pub, [app(), kindIs("reveal"), eq("vendor", addr(vendor))]);
}

export { and };
