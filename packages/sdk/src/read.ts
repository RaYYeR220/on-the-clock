// Every read the app makes. Each one is a single Arkiv query (plus cursor pages), written out in
// /arkiv/schema.md so anyone can run it without our backend.
import { ENTITY_EVENTS_ABI, NoEntityFoundError, type PublicArkivClient } from "@arkiv-network/sdk";
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

const ARKIV = "0x4400000000000000000000000000000000000044" as const;
const CREATED = ENTITY_EVENTS_ABI.find((e) => e.name === "EntityCreated")!;
const EXTENDED = ENTITY_EVENTS_ABI.find((e) => e.name === "ExpiryExtended")!;

/**
 * The clock's last on-chain expiry, from its own logs: the EntityCreated expiry, raised by every
 * ExpiryExtended. This is what the chain actually did, independent of anyone's records. Returns
 * undefined when the logs cannot be read (e.g. the RPC refuses the range).
 */
const goneExpiry = new Map<string, bigint>();

export async function clockChainExpiry(pub: PublicArkivClient, clockKey: Hex, fromBlock: bigint, head?: bigint): Promise<bigint | undefined> {
  // Only ever called for clocks that are gone, whose logs can no longer change: cache the answer.
  const cached = goneExpiry.get(clockKey.toLowerCase());
  if (cached !== undefined) return cached;
  const found = await readChainExpiry(pub, clockKey, fromBlock, head);
  if (found !== undefined) goneExpiry.set(clockKey.toLowerCase(), found);
  return found;
}

async function readChainExpiry(pub: PublicArkivClient, clockKey: Hex, fromBlock: bigint, head?: bigint): Promise<bigint | undefined> {
  const toBlock = head ?? (await pub.getBlockNumber());
  const read = async (from: bigint, to: bigint) => {
    const [created, extended] = await Promise.all([
      pub.getLogs({ address: ARKIV, event: CREATED, args: { entityKey: clockKey }, fromBlock: from, toBlock: to }),
      pub.getLogs({ address: ARKIV, event: EXTENDED, args: { entityKey: clockKey }, fromBlock: from, toBlock: to }),
    ]);
    return [...created, ...extended].map((l) => (l.args as { expiresAt?: bigint }).expiresAt ?? 0n);
  };
  let values: bigint[];
  try {
    values = await read(fromBlock, toBlock);
  } catch {
    // Fall back to fixed windows if the RPC limits the range.
    values = [];
    try {
      for (let from = fromBlock; from <= toBlock; from += 50_000n) {
        const to = from + 49_999n < toBlock ? from + 49_999n : toBlock;
        values.push(...(await read(from, to)));
      }
    } catch {
      return undefined;
    }
  }
  return values.length ? values.reduce((a, b) => (b > a ? b : a), 0n) : undefined;
}
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
  const liveClock = all.find((e) => isCaseClock(caseEntity, e)) ?? null;
  const [inboxes, chainExpiry] = await Promise.all([
    inboxesFor(pub, caseEntity, all),
    liveClock ? Promise.resolve(undefined) : clockChainExpiry(pub, caseEntity.payload.clock, caseEntity.createdAt, head),
  ]);
  // The clock is the entity the case file committed to, by the same author. Anything else that
  // calls itself a clock for this case is noise someone else wrote.
  const clock = all.find((e) => isCaseClock(caseEntity, e)) ?? null;
  const related = all.filter((e) => e !== caseEntity && e !== clock);
  return { view: deriveCase({ caseEntity, related, clock, head, inboxes, ...(chainExpiry !== undefined ? { chainExpiry } : {}) }), caseEntity, related, clock, head };
}

/**
 * The inbox a reveal names, fetched so attribution can be checked. If the vendor deleted it, fall back
 * to the inbox as it stood when the case was filed (historical query; Tiramisu keeps about 11 days).
 */
async function inboxesFor(pub: PublicArkivClient, caseEntity: OtcEntity<CasePayload>, related: OtcEntity[]): Promise<OtcEntity<InboxPayload>[]> {
  for (const r of related) {
    if (r.kind !== "reveal") continue;
    const k = (r.payload as RevealPayload | null)?.key;
    if (typeof k !== "string") continue;
    const check = verifyRevealKey(caseEntity.key, caseEntity.payload, k as Hex);
    if (!check.bundle) continue;
    const live = await getOne<InboxPayload>(pub, check.bundle.inbox);
    if (live) return [live];
    try {
      return await fetchAll<InboxPayload>(pub, [app(), eq("$key", key(check.bundle.inbox))], { atBlock: caseEntity.createdAt });
    } catch {
      return []; // outside the history window: attribution stays "unknown"
    }
  }
  return [];
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
  const inboxes = all.filter((e) => e.kind === "inbox") as OtcEntity<InboxPayload>[];
  const prepared = (all.filter((e) => e.kind === "case") as OtcEntity<CasePayload>[]).map((caseEntity) => {
    const rel = byCase.get(caseEntity.key.toLowerCase()) ?? [];
    const clock = rel.find((r) => isCaseClock(caseEntity, r)) ?? null;
    return { caseEntity, clock, related: rel.filter((r) => r !== clock) };
  });
  // Gone clocks need their logs; read them a few at a time rather than one after another.
  const expiries = await mapLimit(prepared, 8, (x) =>
    x.clock ? Promise.resolve(undefined) : clockChainExpiry(pub, x.caseEntity.payload.clock, x.caseEntity.createdAt, head),
  );
  const cases: CaseBundle[] = prepared.map(({ caseEntity, clock, related }, i) => {
    const chainExpiry = expiries[i];
    return {
      view: deriveCase({ caseEntity, related, clock, head, inboxes, ...(chainExpiry !== undefined ? { chainExpiry } : {}) }),
      caseEntity,
      related,
      clock,
      head,
    };
  });
  return {
    head,
    cases,
    inboxes,
    watchers: dedupeByCreator(all.filter((e) => e.kind === "watcher") as OtcEntity<WatcherPayload>[]),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
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

export async function listInboxes(pub: PublicArkivClient, vendor?: Address): Promise<OtcEntity<InboxPayload>[]> {
  return fetchAll<InboxPayload>(pub, [app(), kindIs("inbox")], vendor ? { createdBy: vendor } : {});
}

/**
 * The inbox to file to, per vendor and name: a vendor that publishes its inbox again replaces the
 * old one for new reports (older inboxes stay alive for the cases already filed to them). Newest first.
 */
export function currentInboxes<T extends OtcEntity<InboxPayload>>(list: T[]): T[] {
  const best = new Map<string, T>();
  for (const i of list) {
    const id = `${i.creator.toLowerCase()}|${i.payload?.name ?? ""}`;
    const have = best.get(id);
    if (!have || i.createdAt > have.createdAt) best.set(id, i);
  }
  return [...best.values()].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
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

/**
 * Reveal entities naming a vendor. The `vendor` attribute is only an index written by whoever posted
 * the reveal: load each case and count it only when its attribution is "verified".
 */
export async function listRevealsForVendor(pub: PublicArkivClient, vendor: Address): Promise<OtcEntity<RevealPayload>[]> {
  return fetchAll<RevealPayload>(pub, [app(), kindIs("reveal"), eq("vendor", addr(vendor))]);
}

export { and };
