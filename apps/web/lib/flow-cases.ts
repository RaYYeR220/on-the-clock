"use client";
// Case operations shared by the demo and the consoles. Every write goes straight to Tiramisu from
// this browser's wallet; nothing is relayed.
import { ExpirationTime, type WalletArkivClient } from "@arkiv-network/sdk";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  RESPONDER_POSTAGE,
  app,
  fetchAll,
  fileCase,
  getOne,
  kindIs,
  openNote,
  scanForVendor,
  stealthPrivateKey,
  type Advisory,
  type CaseBundle,
  type CasePayload,
  type FiledCase,
  type InboxCase,
  type InboxPayload,
  type OtcEntity,
  type Report,
  type StealthKeys,
  type VendorActPayload,
  type VendorMatch,
} from "on-the-clock-sdk";
import { readClient, writeClient } from "./arkiv";
import { roleKeys } from "./burner";
import { Plainly, saveAdvisoryKey } from "./flow-common";
import type { WatcherSet } from "./flow-watchers";

export const inboxRef = (e: OtcEntity<InboxPayload>) => ({
  key: e.key,
  creator: e.creator,
  payload: e.payload,
  expiresAt: e.expiresAt,
  permissionlessExtension: e.permissionlessExtension,
});

export interface ReportInput {
  advisory: Advisory;
  report: Omit<Report, "pocHash" | "advisory">;
  poc: string;
}

/** Files one sealed case (one atomic batch) and keeps K in this browser. Postage is sent separately. */
export async function fileReport(account: PrivateKeyAccount, inbox: OtcEntity<InboxPayload>, input: ReportInput, embargoSeconds: number, watchers: WatcherSet): Promise<FiledCase> {
  if (!watchers.enough) throw new Plainly("Fewer than two watchers are on duty, so nothing could release this advisory at the deadline. Filing is paused until at least two are back.");
  const { selfPrivateKey } = await roleKeys(account);
  const filed = await fileCase(writeClient(account), readClient(), {
    report: { ...input.report, advisory: input.advisory },
    advisory: input.advisory,
    poc: input.poc,
    inbox: inboxRef(inbox),
    watchers: watchers.refs,
    k: watchers.k,
    researcherSelfKey: selfPrivateKey,
    embargoSeconds,
    postage: false,
  });
  saveAdvisoryKey(filed.caseKey, filed.sealed.advisoryKey);
  return filed;
}

/** Gas for the vendor's one-time responder, so answering costs the vendor nothing traceable. */
export async function sendPostage(account: PrivateKeyAccount, responder: Address): Promise<Hex> {
  const w = writeClient(account);
  return w.sendTransaction({ to: responder, value: RESPONDER_POSTAGE, account, chain: w.chain });
}

export async function vendorKeys(account: PrivateKeyAccount): Promise<StealthKeys> {
  return (await roleKeys(account)).stealth;
}

/** Trial-decrypts recent cases against the vendor's keys. Only this browser can tell which are theirs. */
export async function scanCases(keys: StealthKeys, maxPages = 5): Promise<{ scanned: number; matches: InboxCase[] }> {
  const cases = await fetchAll<CasePayload>(readClient(), [app(), kindIs("case")], { maxPages });
  return { scanned: cases.length, matches: scanForVendor(cases, keys) };
}

export interface Responder {
  account: PrivateKeyAccount;
  wallet: WalletArkivClient;
}

/** The case's one-time responder: p_spend + h. Only the vendor's spending key can produce it. */
export function responderFor(keys: StealthKeys, match: VendorMatch): Responder {
  const account = privateKeyToAccount(stealthPrivateKey(keys.spendingPrivateKey, match.hashedSharedSecret));
  return { account, wallet: writeClient(account) };
}

export interface Attempt {
  refused: boolean;
  notOwner: boolean;
  message: string;
  txHash?: Hex;
  owner?: Address;
  caller: Address;
  at: number;
}

/**
 * The vendor tries to push the deadline back with its own wallet. Gas is fixed so the transaction is
 * mined (and reverts on chain) instead of being stopped by an estimate first.
 */
export async function tryExtendClock(responder: Responder, clockKey: Hex): Promise<Attempt> {
  const pub = readClient();
  const caller = responder.account.address;
  const clock = await getOne(pub, clockKey);
  if (!clock) throw new Plainly("The clock has already run out, so there is nothing left to extend. The refusal only shows while the clock is running.");
  const head = await pub.getBlockNumber();
  try {
    const r = await responder.wallet.extendEntity({ entityKey: clockKey, expires: ExpirationTime.atBlock(head + 100_000n) }, { gas: 300_000n });
    return { refused: false, notOwner: false, message: "The extension went through.", txHash: r.txHash, caller, at: Date.now() };
  } catch (e) {
    const err = e as { message?: string; txHash?: unknown };
    const message = String(err.message ?? e).split("\n")[0]!;
    const txHash = typeof err.txHash === "string" ? (err.txHash as Hex) : undefined;
    const reverted = !!txHash || /revert|NotOwner|is owned by/i.test(message);
    if (!reverted) throw e;
    const owner = clock.owner;
    const notOwner = /NotOwner|is owned by/i.test(message) || owner.toLowerCase() !== caller.toLowerCase();
    return { refused: true, notOwner, message, ...(txHash ? { txHash } : {}), owner, caller, at: Date.now() };
  }
}

/** Retries a read until it returns something: Arkiv indexes a new entity a block or two after it lands. */
export async function settle<T>(read: () => Promise<T | null | undefined>, tries = 10, ms = 2_000): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (v) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return null;
}

const eqAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Verified extension requests no verified grant has answered yet. */
export function pendingRequests(bundle: CaseBundle) {
  const { view, related } = bundle;
  const answered = new Set(
    related
      .filter((e) => e.kind === "grant" && view.timeline.some((t) => t.key === e.key && t.verdict === "verified"))
      .map((e) => String((e.payload as { request?: string } | null)?.request ?? "").toLowerCase())
      .filter(Boolean),
  );
  return view.timeline.filter((t) => t.kind === "extreq" && t.verdict === "verified" && !answered.has(t.key.toLowerCase()));
}

/** Vendor notes sealed to the researcher, opened with the researcher's own key. */
export function vendorNotes(bundle: CaseBundle, selfKey: Hex) {
  const out: { key: Hex; kind: string; block: bigint; note: string }[] = [];
  for (const e of bundle.related) {
    if (!["ack", "extreq", "fixed"].includes(e.kind) || !eqAddr(e.creator, bundle.view.responder)) continue;
    const box = (e.payload as VendorActPayload | null)?.note;
    if (!box) continue;
    try {
      out.push({ key: e.key, kind: e.kind, block: e.createdAt, note: openNote(bundle.caseEntity.key, box, selfKey) });
    } catch {
      // not sealed to this researcher
    }
  }
  return out.sort((a, b) => (a.block < b.block ? -1 : 1));
}

export { eqAddr };
