"use client";
// The guided demo: the end-to-end run, one step per button, with progress kept in this browser so a
// reload resumes where it stopped. Each runner saves what it has done before its next write, so a
// retry never repeats a transaction that already landed.
import type { Address, Hex } from "viem";
import { RESPONDER_POSTAGE, createInbox, getOne, grantExtension, loadCase, vendorAct, type CasePayload, type InboxPayload, type Severity } from "on-the-clock-sdk";
import { readClient, writeClient } from "./arkiv";
import { burner, roleKeys } from "./burner";
import { Plainly, readJson, removeKey, writeJson } from "./flow-common";
import { fileReport, responderFor, scanCases, sendPostage, settle, tryExtendClock, vendorKeys, type Attempt, type Responder } from "./flow-cases";
import { topUp } from "./flow-wallet";
import type { WatcherSet } from "./flow-watchers";

export const DEMO_EMBARGO = 180;
export const DEMO_GRANT = 60;
const SLOT = "otc.demo.v1";

export interface DemoState {
  v: 1;
  step: number;
  auto: boolean;
  startedAt: number;
  wallets?: { vendor: Address; researcher: Address; vendorTx: string | null; researcherTx: string | null; vendorBalance: string; researcherBalance: string };
  inbox?: { key: Hex; tx: Hex; name: string };
  filing?: { caseKey: Hex; clockKey: Hex; triggerKeys: Hex[]; tx: Hex; deadlineBlock: string; responder: Address; k: number; n: number };
  postageTx?: Hex;
  scan?: { scanned: number; matched: number; responder: Address };
  ack?: { key: Hex; tx: Hex };
  extreq?: { key: Hex; tx: Hex };
  refusal?: Attempt;
  grant?: { tx: Hex; seconds: number };
  skipped?: boolean;
}

export const freshDemo = (auto = false): DemoState => ({ v: 1, step: 0, auto, startedAt: Date.now() });

export function loadDemo(): DemoState | null {
  const s = readJson<DemoState>(SLOT);
  return s && s.v === 1 && typeof s.step === "number" ? s : null;
}
export const saveDemo = (s: DemoState) => writeJson(SLOT, s);
export const clearDemo = () => removeKey(SLOT);

export const DEMO_REPORT = {
  advisory: {
    title: "Session tokens survive a password reset",
    component: "auth/session · rotate()",
    severity: 3 as Severity,
    cwe: "CWE-613",
    summary: "Synthetic demo advisory. Changing a password does not revoke sessions that were already open, so a stolen session token keeps working after the reset.",
    researcher: "demo researcher (synthetic)",
  },
  report: {
    details: "Synthetic demo report. rotate() issues a new token for the current session but never invalidates the others in the session table.",
    impact: "An attacker holding a stolen token keeps access after the victim resets their password.",
    reproduction: "1. Sign in on two devices. 2. Reset the password on the first. 3. The second device is still signed in.",
    contact: "demo-researcher (synthetic)",
  },
  poc: "Synthetic proof of concept for the demo. It stays in this browser; only its SHA-256 is filed.",
};

export interface Ctx {
  get: () => DemoState;
  save: (patch: Partial<DemoState>) => void;
  watchers: WatcherSet | null;
}

const short = () => Math.random().toString(36).slice(2, 6).toUpperCase();

export async function stepWallets(ctx: Ctx) {
  const vendor = burner("vendor");
  const researcher = burner("researcher");
  // The researcher pays for the filing, the grant and the vendor's postage.
  const r = await topUp(researcher.address, RESPONDER_POSTAGE + RESPONDER_POSTAGE / 4n);
  const v = await topUp(vendor.address);
  ctx.save({
    wallets: {
      vendor: vendor.address,
      researcher: researcher.address,
      vendorTx: v.tx,
      researcherTx: r.tx,
      vendorBalance: v.balance.toString(),
      researcherBalance: r.balance.toString(),
    },
    step: 1,
  });
}

export async function stepInbox(ctx: Ctx) {
  const vendor = burner("vendor");
  const { stealth } = await roleKeys(vendor);
  const name = `Demo vendor · ${short()}`;
  const r = await createInbox(writeClient(vendor), {
    name,
    meta: stealth.metaAddress,
    policy: "Synthetic demo vendor, created by the On the Clock demo. Acknowledges within 7 days; 90-day embargo by default.",
    sla: 7,
    embargo: 90,
  });
  ctx.save({ inbox: { key: r.entityKey, tx: r.txHash, name }, step: 2 });
}

export async function stepFile(ctx: Ctx) {
  const s = ctx.get();
  if (!s.inbox) throw new Plainly("The vendor's inbox is missing from this run. Start over.");
  const researcher = burner("researcher");
  if (!s.filing) {
    const set = ctx.watchers;
    if (!set) throw new Plainly("Still reading the watcher list from Arkiv. Try again in a moment.");
    const key = s.inbox.key;
    const inbox = await settle(() => getOne<InboxPayload>(readClient(), key));
    if (!inbox) throw new Plainly("The vendor's inbox is not readable on Tiramisu yet. Try again in a few seconds.");
    const filed = await fileReport(researcher, inbox, DEMO_REPORT, DEMO_EMBARGO, set);
    ctx.save({
      filing: {
        caseKey: filed.caseKey,
        clockKey: filed.clockKey,
        triggerKeys: filed.triggerKeys,
        tx: filed.txHash,
        deadlineBlock: filed.deadlineBlock.toString(),
        responder: filed.sealed.responder,
        k: filed.sealed.payload.k,
        n: filed.sealed.payload.watchers.length,
      },
    });
  }
  const filing = ctx.get().filing!;
  if (!ctx.get().postageTx) ctx.save({ postageTx: await sendPostage(researcher, filing.responder) });
  ctx.save({ step: 3 });
}

const responders = new Map<string, { responder: Responder; payload: CasePayload }>();

/** Finds the case the way a vendor would, by trial-decrypting, and derives its responder. */
async function findAsVendor(ctx: Ctx) {
  const filing = ctx.get().filing;
  if (!filing) throw new Plainly("This run has no filed case. Start over.");
  const hit = responders.get(filing.caseKey);
  if (hit) return hit;
  const keys = await vendorKeys(burner("vendor"));
  const found = await settle(async () => {
    const r = await scanCases(keys, 3);
    const m = r.matches.find((x) => x.caseEntity.key.toLowerCase() === filing.caseKey.toLowerCase());
    return m ? { ...r, m } : null;
  }, 12);
  if (!found) throw new Plainly("The vendor scanned the latest cases and did not find this one yet. Arkiv may still be indexing it; try again in a few seconds.");
  const responder = responderFor(keys, found.m.match);
  if (responder.account.address.toLowerCase() !== filing.responder.toLowerCase()) throw new Plainly("The derived responder does not match the case. Start over.");
  ctx.save({ scan: { scanned: found.scanned, matched: found.matches.length, responder: responder.account.address } });
  const entry = { responder, payload: found.m.caseEntity.payload };
  responders.set(filing.caseKey, entry);
  return entry;
}

export async function stepAck(ctx: Ctx) {
  const s = ctx.get();
  if (!s.filing) throw new Plainly("This run has no filed case. Start over.");
  if (!s.postageTx) throw new Plainly("The responder's postage was never sent. Go back one step.");
  // The responder's only money is the researcher's postage.
  await readClient().waitForTransactionReceipt({ hash: s.postageTx, timeout: 60_000 });
  const { responder, payload } = await findAsVendor(ctx);
  const caseKey = s.filing.caseKey;
  if (!ctx.get().ack) {
    const a = await vendorAct(responder.wallet, caseKey, payload, "ack", { note: "Received. Triaging now. (synthetic)" });
    ctx.save({ ack: { key: a.entityKey, tx: a.txHash } });
  }
  if (!ctx.get().extreq) {
    const r = await vendorAct(responder.wallet, caseKey, payload, "extreq", { seconds: DEMO_GRANT, note: "The patch is in review; we need one more minute. (synthetic)" });
    ctx.save({ extreq: { key: r.entityKey, tx: r.txHash } });
  }
  ctx.save({ step: 4 });
}

export async function stepRefusal(ctx: Ctx) {
  const s = ctx.get();
  if (!s.filing) throw new Plainly("This run has no filed case. Start over.");
  const { responder } = await findAsVendor(ctx);
  const attempt = await tryExtendClock(responder, s.filing.clockKey);
  ctx.save({ refusal: attempt, step: 5 });
}

export async function stepGrant(ctx: Ctx) {
  const s = ctx.get();
  if (!s.filing) throw new Plainly("This run has no filed case. Start over.");
  const bundle = await loadCase(readClient(), s.filing.caseKey);
  if (!bundle) throw new Plainly("The case is not readable on Tiramisu yet. Try again in a few seconds.");
  if (!bundle.view.clock.live) throw new Plainly("The clock ran out before the extension could be granted, so there is nothing left to extend. Skip ahead and watch the deadline publish itself.");
  const g = await grantExtension(writeClient(burner("researcher")), bundle, { seconds: DEMO_GRANT, ...(s.extreq ? { request: s.extreq.key } : {}) });
  ctx.save({ grant: { tx: g.txHash, seconds: DEMO_GRANT }, step: 6 });
}

export const RUNNERS: Record<number, (ctx: Ctx) => Promise<void>> = {
  0: stepWallets,
  1: stepInbox,
  2: stepFile,
  3: stepAck,
  4: stepRefusal,
  5: stepGrant,
};
