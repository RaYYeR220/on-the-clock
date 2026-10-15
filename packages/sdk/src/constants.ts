import type { Address } from "viem";

/** Every On the Clock entity carries `app = "onclock"`, so one predicate scopes a query to the protocol. */
export const APP = "onclock";
export const SCHEMA_VERSION = 1;

export const KINDS = [
  "inbox",
  "case",
  "clock",
  "trigger",
  "ack",
  "extreq",
  "fixed",
  "grant",
  "handoff",
  "watcher",
  "receipt",
  "reveal",
] as const;
export type Kind = (typeof KINDS)[number];

/** Vendor actions, written from the case's stealth responder address. */
export const VENDOR_KINDS = ["ack", "extreq", "fixed"] as const satisfies readonly Kind[];
/** Custodian actions, written by whoever holds the clock. */
export const CUSTODIAN_KINDS = ["grant", "handoff"] as const satisfies readonly Kind[];

export const OUTCOMES = ["lapsed", "withdrawn", "disclosed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Sealed entities are handed to this address in the batch that creates them, so nobody can delete them. */
export const SEALED_OWNER: Address = "0x000000000000000000000000000000000000dEaD";

export const BLOCK_SECONDS = 2;
const DAY = 86_400;

/** Entity Expiration per type, in seconds. Each lifetime follows what the entity means. */
export const LIFETIME = {
  /** The inbox lives while the vendor keeps showing up: a 30-day lease, renewed on activity. */
  inboxLease: 30 * DAY,
  /** Case files and every act on them are records that must outlive the case. */
  record: 365 * DAY,
  /** Triggers hold the escrowed shares; they outlive the clock by a grace window for slow watchers. */
  triggerGrace: 7 * DAY,
  /** A watcher is alive while its lease is alive. */
  watcherLease: 10 * 60,
  /** How often a watcher renews its lease. */
  watcherHeartbeat: 3 * 60,
} as const;

export const SEVERITY = { 1: "low", 2: "medium", 3: "high", 4: "critical" } as const;
export type Severity = keyof typeof SEVERITY;

export const RECOMMENDED_EMBARGO_DAYS = 90;
