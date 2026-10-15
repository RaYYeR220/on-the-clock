// Every write in the protocol. Anything that must land together goes in one atomic batch.
import { ExpirationTime, type PublicArkivClient, type WalletArkivClient } from "@arkiv-network/sdk";
import { parseEther, type Address, type Hex } from "viem";
import { BLOCK_SECONDS, LIFETIME, SEALED_OWNER, type Kind } from "./constants.js";
import { A, baseAttrs, encodePayload } from "./codec.js";
import type { MetaAddress } from "./crypto/stealth.js";
import { sealCase, sealNote, type SealCaseInput, type SealedCase } from "./seal.js";
import type { CaseBundle } from "./read.js";
import type {
  CasePayload,
  GrantPayload,
  HandoffPayload,
  InboxPayload,
  RevealPayload,
  VendorActPayload,
} from "./types.js";

const JSON_TYPE = "application/json";
export const blocks = (seconds: number) => BigInt(Math.ceil(seconds / BLOCK_SECONDS));
const accountOf = (w: WalletArkivClient): Address => {
  if (!w.account) throw new Error("wallet client has no account");
  return w.account.address;
};

/** Gas money the researcher sends the vendor's one-time responder address, so answering costs the vendor nothing traceable. */
export const RESPONDER_POSTAGE = parseEther("0.002");

// ---------- vendor: inbox ----------

export interface InboxInput {
  name: string;
  meta: MetaAddress;
  policy: string;
  sla: number;
  embargo: number;
  contact?: string;
}

export async function createInbox(wallet: WalletArkivClient, input: InboxInput) {
  const payload: InboxPayload = { v: 1, ...input };
  return wallet.createEntity({
    payload: encodePayload(payload),
    contentType: JSON_TYPE,
    attributes: { ...baseAttrs("inbox"), name: A.str(input.name.slice(0, 64)), sla: A.u64(input.sla), embargo: A.u64(input.embargo) },
    expires: ExpirationTime.fromSeconds(LIFETIME.inboxLease),
    // readonly: a vendor cannot swap its keys under an open case. Rotation means a new inbox.
    // permissionlessExtension: anyone who depends on the inbox (a researcher with an open case against
    // it) can keep it alive, so a vendor cannot dodge attribution by letting it lapse.
    flags: { readonly: true, permissionlessExtension: true },
  });
}

/**
 * The inbox is a lease: it stays alive while the vendor keeps showing up. Returns null when the lease
 * already runs past a fresh 30 days (a filing extends it), since a shorter target would revert.
 */
export async function renewInbox(wallet: WalletArkivClient, pub: PublicArkivClient, inboxKey: Hex) {
  const [head, current] = await Promise.all([pub.getBlockNumber(), pub.getEntity(inboxKey)]);
  const target = head + blocks(LIFETIME.inboxLease);
  if (BigInt(current.expiresAt) >= target) return null;
  return wallet.extendEntity({ entityKey: inboxKey, expires: ExpirationTime.atBlock(target) });
}

// ---------- researcher: filing ----------

export interface FileCaseInput extends Omit<SealCaseInput, "caseKey" | "clockKey" | "deadlineBlock" | "deadlineAt"> {
  /** Seconds from now until the embargo ends. */
  embargoSeconds: number;
  /** Fund the vendor's responder address in a follow-up transfer (default true). */
  postage?: boolean;
}

export interface FiledCase {
  sealed: SealedCase;
  caseKey: Hex;
  clockKey: Hex;
  triggerKeys: Hex[];
  deadlineBlock: bigint;
  txHash: Hex;
  postageTx?: Hex;
  /** Set when the filing landed but the follow-up postage transfer failed; the case is still valid. */
  postageError?: string;
}

/**
 * Files a case in ONE atomic batch: the sealed case file, the clock whose expiry is the deadline,
 * and one trigger per watcher holding its encrypted share. The case file and the triggers are handed
 * to the sealed owner in the same batch, so they can never be edited or deleted. A filing that half
 * lands (a clock with no escrow, or escrow with no clock) cannot exist.
 */
export async function fileCase(wallet: WalletArkivClient, pub: PublicArkivClient, input: FileCaseInput): Promise<FiledCase> {
  const owner = accountOf(wallet);
  const n = input.watchers.length;
  const predicted = await pub.predictEntityKeys({ owner, count: n + 2 });
  const [caseSlot, clockSlot, ...triggerSlots] = predicted;
  if (!caseSlot || !clockSlot || triggerSlots.length !== n) throw new Error("key prediction returned too few keys");

  const head = await pub.getBlockNumber();
  const deadlineBlock = head + blocks(input.embargoSeconds);
  const deadlineAt = Math.floor(Date.now() / 1000) + input.embargoSeconds;
  const sealed = await sealCase({ ...input, caseKey: caseSlot.key, clockKey: clockSlot.key, deadlineBlock, deadlineAt });

  const triggerExpiry = deadlineBlock + blocks(LIFETIME.triggerGrace);
  // Filing keeps the vendor's inbox alive until the case can be attributed: deadline plus a month.
  const inboxFloor = deadlineBlock + blocks(LIFETIME.inboxLease);
  const extendInbox =
    input.inbox.permissionlessExtension && input.inbox.expiresAt !== undefined && inboxFloor > input.inbox.expiresAt
      ? [{ entityKey: input.inbox.key, expires: ExpirationTime.atBlock(inboxFloor) }]
      : [];
  const res = await wallet.executeBatch({
    creates: [
      {
        payload: encodePayload(sealed.payload),
        contentType: JSON_TYPE,
        attributes: { ...baseAttrs("case"), sev: A.u64(input.advisory.severity) },
        expires: ExpirationTime.fromSeconds(LIFETIME.record),
        flags: { readonly: true, permissionlessExtension: true },
        salt: caseSlot.salt,
      },
      {
        payload: encodePayload({ v: 1 }),
        contentType: JSON_TYPE,
        attributes: { ...baseAttrs("clock"), case: A.key(caseSlot.key) },
        // The deadline itself. Only the clock's owner can move it.
        expires: ExpirationTime.atBlock(deadlineBlock),
        flags: { readonly: true },
        salt: clockSlot.salt,
      },
      ...sealed.triggers.map((t, i) => ({
        payload: encodePayload(t.payload),
        contentType: JSON_TYPE,
        attributes: {
          ...baseAttrs("trigger"),
          case: A.key(caseSlot.key),
          target: A.key(clockSlot.key),
          watcher: A.addr(t.watcher.address),
          action: A.str("release"),
        },
        expires: ExpirationTime.atBlock(triggerExpiry),
        // Anyone, including a coordinator the clock is handed to, can keep the escrow alive.
        flags: { readonly: true, permissionlessExtension: true },
        salt: triggerSlots[i]!.salt,
      })),
    ],
    extensions: extendInbox,
    ownershipChanges: [
      { entityKey: caseSlot.key, newOwner: SEALED_OWNER },
      ...triggerSlots.map((s) => ({ entityKey: s.key, newOwner: SEALED_OWNER })),
    ],
  });

  // The filing has landed; a failed postage transfer must not lose the case key or K.
  let postageTx: Hex | undefined;
  let postageError: string | undefined;
  if (input.postage !== false) {
    try {
      postageTx = await sendPostage(wallet, sealed.responder);
    } catch (e) {
      postageError = e instanceof Error ? (e.message.split("\n")[0] ?? e.message) : String(e);
    }
  }
  return {
    sealed,
    caseKey: caseSlot.key,
    clockKey: clockSlot.key,
    triggerKeys: triggerSlots.map((s) => s.key),
    deadlineBlock,
    txHash: res.txHash,
    ...(postageTx ? { postageTx } : {}),
    ...(postageError ? { postageError } : {}),
  };
}

/** Pays a case's one-time responder its gas. Anyone can send it; the researcher normally does. */
export async function sendPostage(wallet: WalletArkivClient, responder: Address, value = RESPONDER_POSTAGE): Promise<Hex> {
  return wallet.sendTransaction({ to: responder, value, account: wallet.account!, chain: wallet.chain });
}

// ---------- custodian: extension, handoff, disclosure ----------

/** The case's own triggers: written by the researcher, aimed at the case's clock. Strangers' entities are never touched. */
export function triggerKeysOf(bundle: CaseBundle): Hex[] {
  const { caseEntity } = bundle;
  const clock = caseEntity.payload.clock.toLowerCase();
  return bundle.related
    .filter(
      (e) =>
        e.kind === "trigger" &&
        e.creator.toLowerCase() === caseEntity.creator.toLowerCase() &&
        String(e.attrs.target).toLowerCase() === clock,
    )
    .map((e) => e.key);
}

/**
 * Grants more time. The clock's expiry, every trigger's expiry and the grant record move together;
 * a clock pushed out without its escrow (or a grant with no extension behind it) cannot exist.
 */
export async function grantExtension(wallet: WalletArkivClient, bundle: CaseBundle, opts: { seconds: number; request?: Hex }) {
  const { seconds } = opts;
  const newExpiry = bundle.view.clock.expiresAt + blocks(seconds);
  const payload: GrantPayload = { v: 1, expiresAt: newExpiry.toString(), ...(opts.request ? { request: opts.request } : {}) };
  return wallet.executeBatch({
    creates: [
      {
        payload: encodePayload(payload),
        contentType: JSON_TYPE,
        attributes: { ...baseAttrs("grant"), case: A.key(bundle.caseEntity.key), seconds: A.u64(seconds) },
        expires: ExpirationTime.fromSeconds(LIFETIME.record),
        flags: { readonly: true },
      },
    ],
    extensions: [
      { entityKey: bundle.view.clock.key, expires: ExpirationTime.atBlock(newExpiry) },
      ...triggerKeysOf(bundle).map((k) => ({ entityKey: k, expires: ExpirationTime.atBlock(newExpiry + blocks(LIFETIME.triggerGrace)) })),
    ],
  });
}

/** Hands the clock to a coordinator. The transfer is the authoritative act; the record makes it queryable. */
export async function handOff(wallet: WalletArkivClient, bundle: CaseBundle, to: Address, reason?: string) {
  const payload: HandoffPayload = { v: 1, ...(reason ? { reason } : {}) };
  return wallet.executeBatch({
    creates: [
      {
        payload: encodePayload(payload),
        contentType: JSON_TYPE,
        attributes: { ...baseAttrs("handoff"), case: A.key(bundle.caseEntity.key), to: A.addr(to) },
        expires: ExpirationTime.fromSeconds(LIFETIME.record),
        flags: { readonly: true },
      },
    ],
    ownershipChanges: [{ entityKey: bundle.view.clock.key, newOwner: to }],
  });
}

/** Early disclosure (usually after a fix): publish K and stop the clock in the same batch. */
export async function discloseEarly(wallet: WalletArkivClient, bundle: CaseBundle, advisoryKey: Hex, vendor: Address, inbox: Hex) {
  return wallet.executeBatch({
    creates: [revealCreate(bundle.caseEntity.key, advisoryKey, "researcher", vendor, inbox)],
    deletes: [{ entityKey: bundle.view.clock.key }],
  });
}

/** Withdraws the case. Watchers see the delete and publish nothing. */
export async function withdraw(wallet: WalletArkivClient, bundle: CaseBundle) {
  return wallet.deleteEntity({ entityKey: bundle.view.clock.key });
}

export function revealCreate(caseKey: Hex, advisoryKey: Hex, by: RevealPayload["by"], vendor: Address, inbox: Hex) {
  const payload: RevealPayload = { v: 1, key: advisoryKey, by };
  return {
    payload: encodePayload(payload),
    contentType: JSON_TYPE,
    attributes: { ...baseAttrs("reveal"), case: A.key(caseKey), vendor: A.addr(vendor), inbox: A.key(inbox), by: A.str(by) },
    expires: ExpirationTime.fromSeconds(LIFETIME.record),
    // A published advisory should outlive anyone's interest in burying it: anyone can extend it.
    flags: { readonly: true, permissionlessExtension: true },
  };
}

// ---------- vendor: acting on a case (from the stealth responder wallet) ----------

export type VendorAct = Extract<Kind, "ack" | "extreq" | "fixed">;

export async function vendorAct(
  responder: WalletArkivClient,
  caseKey: Hex,
  casePayload: CasePayload,
  act: VendorAct,
  opts: { seconds?: number; note?: string } = {},
) {
  const payload: VendorActPayload = { v: 1, ...(opts.note ? { note: sealNote(caseKey, casePayload, opts.note) } : {}) };
  return responder.createEntity({
    payload: encodePayload(payload),
    contentType: JSON_TYPE,
    attributes: {
      ...baseAttrs(act),
      case: A.key(caseKey),
      ...(act === "extreq" ? { seconds: A.u64(opts.seconds ?? 30 * 86_400) } : {}),
    },
    expires: ExpirationTime.fromSeconds(LIFETIME.record),
    flags: { readonly: true },
  });
}
