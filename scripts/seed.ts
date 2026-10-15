// Seeds the public demo: synthetic vendors and cases in every state, with deadlines that fall inside
// the judging window so lapses happen live. All names and reports are invented.
//
//   node --env-file=../.env seed.ts
//
// Advisory keys (needed only for early disclosure) go to ../.seed-secrets.json, which is gitignored:
// committing them would publish advisories before their deadlines.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Hex } from "viem";
import {
  KEY_MESSAGE,
  createInbox,
  discloseEarly,
  fileCase,
  getOne,
  grantExtension,
  handOff,
  keysFromSignature,
  loadCase,
  publicKeyOf,
  scanForVendor,
  stealthPrivateKey,
  vendorAct,
  withdraw,
  type Advisory,
  type CasePayload,
  type InboxPayload,
  type OtcEntity,
} from "on-the-clock-sdk";
import { account, log, pub, saveProof, sleep, wallet, walletFor, watcherEncKey } from "./lib.ts";

const SECRETS = "../.seed-secrets.json";
const secrets: Record<string, Hex> = existsSync(SECRETS) ? JSON.parse(readFileSync(SECRETS, "utf8")) : {};
const keep = () => writeFileSync(SECRETS, JSON.stringify(secrets, null, 2));

const refs = ["WATCHER_1", "WATCHER_2", "WATCHER_3"].map((n) => ({ address: account(n).address, pubkey: publicKeyOf(watcherEncKey(n)) }));
const until = (iso: string) => Math.max(120, Math.floor((Date.parse(iso) - Date.now()) / 1000));

// ---------- vendors ----------
const VENDORS = [
  // SEED_VENDOR_1 is the end-to-end run's test vendor; the demo vendors use their own wallets.
  { who: "SEED_VENDOR_4", name: "Tidewater Bridge (demo)", sla: 7, embargo: 90, policy: "Demo vendor. We acknowledge within 7 days and ask for no more than one extension." },
  { who: "SEED_VENDOR_2", name: "Larkspur Lending (demo)", sla: 3, embargo: 60, policy: "Demo vendor. Critical reports acknowledged within 72 hours." },
  { who: "SEED_VENDOR_3", name: "Quarry Oracles (demo)", sla: 14, embargo: 90, policy: "Demo vendor. Coordinated disclosure, 90 days by default." },
];
const vendors: { who: string; inbox: OtcEntity<InboxPayload>; keys: ReturnType<typeof keysFromSignature>["stealth"] }[] = [];
for (const v of VENDORS) {
  const keys = keysFromSignature(await account(v.who).signMessage({ message: KEY_MESSAGE })).stealth;
  const r = await createInbox(wallet(v.who), { name: v.name, meta: keys.metaAddress, policy: v.policy, sla: v.sla, embargo: v.embargo });
  const inbox = (await getOne<InboxPayload>(pub, r.entityKey))!;
  vendors.push({ who: v.who, inbox, keys });
  log("inbox", { vendor: v.name, key: r.entityKey, tx: r.txHash });
}

// ---------- cases ----------
type Plan = {
  id: string;
  researcher: "SEED_RESEARCHER_1" | "SEED_RESEARCHER_2";
  vendor: number;
  advisory: Advisory;
  deadline: string | number; // ISO date or seconds from now
  ack?: boolean;
  request?: number; // seconds asked for
  grant?: number; // seconds granted
  fixed?: boolean;
  handoff?: boolean;
  withdraw?: boolean;
  discloseEarly?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "oracle-stale",
    researcher: "SEED_RESEARCHER_2",
    vendor: 2,
    deadline: "2026-10-19T14:00:00Z",
    ack: true,
    request: 86_400,
    grant: 86_400,
    advisory: { title: "Stale price accepted after a heartbeat gap", component: "oracle/aggregator", severity: 3, cwe: "CWE-672", summary: "When a feed misses two heartbeats the aggregator keeps serving the last round without a staleness flag.", researcher: "tessellate" },
  },
  {
    id: "liq-rounding",
    researcher: "SEED_RESEARCHER_1",
    vendor: 1,
    deadline: "2026-10-20T16:00:00Z",
    ack: true,
    fixed: true,
    advisory: { title: "Liquidation bonus rounds in the liquidator's favour", component: "lending/liquidate()", severity: 2, cwe: "CWE-682", summary: "Rounding the seized collateral up instead of down lets repeated small liquidations extract more than the bonus.", researcher: "anon-7" },
  },
  {
    id: "sealed-critical",
    researcher: "SEED_RESEARCHER_2",
    vendor: 1,
    deadline: "2026-10-21T18:00:00Z",
    advisory: { title: "Unchecked delegatecall target in the upgrade path", component: "lending/proxy", severity: 4, cwe: "CWE-829", summary: "The upgrade helper delegatecalls an address taken from calldata without checking it against the registry.", researcher: "tessellate" },
  },
  {
    id: "coordinated",
    researcher: "SEED_RESEARCHER_1",
    vendor: 2,
    deadline: "2026-10-22T12:00:00Z",
    ack: true,
    handoff: true,
    advisory: { title: "Signer set can be rotated by a single key", component: "oracle/governance", severity: 3, cwe: "CWE-284", summary: "rotateSigners() checks one signature instead of the configured threshold.", researcher: "anon-7" },
  },
  {
    id: "withdrawn",
    researcher: "SEED_RESEARCHER_2",
    vendor: 0,
    deadline: "2026-10-23T12:00:00Z",
    withdraw: true,
    advisory: { title: "Duplicate report (withdrawn)", component: "bridge/relayer", severity: 1, summary: "Withdrawn by the researcher: already known to the vendor.", researcher: "tessellate" },
  },
  {
    id: "early",
    researcher: "SEED_RESEARCHER_1",
    vendor: 0,
    deadline: "2026-10-23T18:00:00Z",
    ack: true,
    fixed: true,
    discloseEarly: true,
    advisory: { title: "Fee-on-transfer tokens break the escrow balance check", component: "bridge/escrow", severity: 2, cwe: "CWE-20", summary: "The escrow assumes the received amount equals the sent amount. Fixed in 2.4.2 and disclosed early with the vendor's agreement.", researcher: "anon-7" },
  },
];

const results: Record<string, unknown>[] = [];
for (const plan of PLANS) {
  const r = account(plan.researcher);
  const rw = wallet(plan.researcher);
  const selfKey = keysFromSignature(await r.signMessage({ message: KEY_MESSAGE })).selfPrivateKey;
  const v = vendors[plan.vendor]!;
  const filed = await fileCase(rw, pub, {
    report: {
      advisory: plan.advisory,
      details: `Synthetic demo report (${plan.id}).`,
      impact: "Synthetic.",
      reproduction: "Synthetic.",
      contact: plan.advisory.researcher,
    },
    advisory: plan.advisory,
    poc: `synthetic poc ${plan.id}`,
    inbox: { key: v.inbox.key, creator: v.inbox.creator, payload: v.inbox.payload, expiresAt: v.inbox.expiresAt, permissionlessExtension: v.inbox.permissionlessExtension },
    watchers: refs,
    k: 2,
    researcherSelfKey: selfKey,
    embargoSeconds: typeof plan.deadline === "number" ? plan.deadline : until(plan.deadline),
  });
  secrets[filed.caseKey] = filed.sealed.advisoryKey as Hex;
  keep();
  log("filed", { id: plan.id, case: filed.caseKey, tx: filed.txHash });
  if (filed.postageTx) await pub.waitForTransactionReceipt({ hash: filed.postageTx });
  const out: Record<string, unknown> = { id: plan.id, case: filed.caseKey, clock: filed.clockKey, filingTx: filed.txHash };

  if (plan.ack || plan.request || plan.fixed) {
    const caseEntity = (await getOne<CasePayload>(pub, filed.caseKey))!;
    const match = scanForVendor([caseEntity], v.keys)[0]!;
    const responder = walletFor(stealthPrivateKey(v.keys.spendingPrivateKey, match.match.hashedSharedSecret));
    if (plan.ack) out.ack = (await vendorAct(responder, filed.caseKey, caseEntity.payload, "ack", { note: "Received." })).txHash;
    if (plan.request) out.request = (await vendorAct(responder, filed.caseKey, caseEntity.payload, "extreq", { seconds: plan.request, note: "Need more time." })).txHash;
    if (plan.fixed) out.fixed = (await vendorAct(responder, filed.caseKey, caseEntity.payload, "fixed", { note: "Patched." })).txHash;
  }
  if (plan.grant) {
    const bundle = (await loadCase(pub, filed.caseKey))!;
    out.grant = (await grantExtension(rw, bundle, { seconds: plan.grant })).txHash;
  }
  if (plan.handoff) {
    const bundle = (await loadCase(pub, filed.caseKey))!;
    out.handoff = (await handOff(rw, bundle, account("SEED_COORDINATOR").address, "Vendor asked for a neutral coordinator.")).txHash;
  }
  if (plan.withdraw) {
    await sleep(4_000);
    const bundle = (await loadCase(pub, filed.caseKey))!;
    out.withdraw = (await withdraw(rw, bundle)).txHash;
  }
  if (plan.discloseEarly) {
    await sleep(4_000);
    const bundle = (await loadCase(pub, filed.caseKey))!;
    out.disclose = (await discloseEarly(rw, bundle, filed.sealed.advisoryKey as Hex, v.inbox.creator, v.inbox.key)).txHash;
  }
  results.push(out);
}

const file = saveProof(`seed-${Date.now()}`, { seededAt: new Date().toISOString(), vendors: vendors.map((v) => ({ who: v.who, inbox: v.inbox.key, vendor: v.inbox.creator })), cases: results });
log("seed written", { file, cases: results.length });
