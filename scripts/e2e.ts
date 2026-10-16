// End-to-end run on Tiramisu: one case from filing to self-publication, with every refusal on record.
//
//   node --env-file=../.env e2e.ts            (starts three watchers in-process)
//   node --env-file=../.env e2e.ts --deployed (relies on the deployed watchers instead)
//
// Writes ../proof/e2e-<timestamp>.json with every transaction hash and entity key.
import { ExpirationTime } from "@arkiv-network/sdk";
import { str } from "@arkiv-network/sdk/attr";
import { privateKeyToAccount } from "viem/accounts";
import { bytesToHex } from "viem/utils";
import type { Hex } from "viem";
import {
  A,
  KEY_MESSAGE,
  Watcher,
  baseAttrs,
  createInbox,
  currentInboxes,
  listInboxes,
  encodePayload,
  fetchAll,
  fileCase,
  getOne,
  grantExtension,
  keysFromSignature,
  kindIs,
  app,
  loadCase,
  publicKeyOf,
  randomBytes,
  resolveReveal,
  scanForVendor,
  stealthPrivateKey,
  vendorAct,
  type CasePayload,
  type InboxPayload,
  type OtcEntity,
} from "on-the-clock-sdk";
import { account, cfg, ent, expectRevert, live, log, pub, saveProof, sleep, tx, wallet, walletFor, watcherEncKey } from "./lib.ts";

const EMBARGO = Number(process.env.E2E_EMBARGO_SECONDS ?? 120);
const GRANT = Number(process.env.E2E_GRANT_SECONDS ?? 60);
const deployed = process.argv.includes("--deployed");
const proof: Record<string, unknown> = { network: "tiramisu", chainId: 7738577, startedAt: new Date().toISOString(), steps: [] };
const steps = proof.steps as Record<string, unknown>[];
const step = (name: string, data: Record<string, unknown>) => {
  steps.push({ name, at: new Date().toISOString(), ...data });
  log(name, data);
};

// ---------- watchers ----------
const WATCHERS = ["WATCHER_1", "WATCHER_2", "WATCHER_3"];
const refs = WATCHERS.map((n) => ({ address: account(n).address, pubkey: publicKeyOf(watcherEncKey(n)) }));
const rejections: Record<string, unknown>[] = [];
const running: Watcher[] = [];
if (!deployed) {
  for (const [i, n] of WATCHERS.entries()) {
    const w = new Watcher({
      pub,
      live: live(),
      wallet: wallet(n),
      encryptionKey: watcherEncKey(n),
      operator: `e2e-${i + 1}`,
      region: "local",
      version: "e2e",
      tickMs: 3_000,
      rescanMs: 20_000,
      log: (msg, data) => {
        if (msg === "trigger rejected") rejections.push({ watcher: n, ...data });
        if (!["jobs added"].includes(msg)) log(`  [${n.toLowerCase()}] ${msg}`, (data ?? {}) as Record<string, unknown>);
      },
    });
    await w.start();
    running.push(w);
  }
}

// ---------- 1. vendor opens an inbox ----------
const vendorAcct = account("SEED_VENDOR_1");
const vendor = wallet("SEED_VENDOR_1");
const vkeys = keysFromSignature(await vendorAcct.signMessage({ message: KEY_MESSAGE })).stealth;
const VENDOR_NAME = "Halcyon Bridge (test vendor)";
// Reuse the test vendor's live inbox from an earlier run, as a real vendor would.
const existing = currentInboxes(await listInboxes(pub, vendorAcct.address)).find(
  (i) => i.payload?.name === VENDOR_NAME && i.payload.meta === vkeys.metaAddress,
);
let inbox: OtcEntity<InboxPayload>;
if (existing) {
  inbox = existing;
  step("vendor opened an inbox in an earlier run (reused)", { inbox: inbox.key, createdAt: inbox.createdAt, by: vendorAcct.address });
} else {
  const inboxTx = await createInbox(vendor, {
    name: VENDOR_NAME,
    meta: vkeys.metaAddress,
    policy: "Synthetic test vendor. Reports acknowledged within 7 days; 90-day embargo by default.",
    sla: 7,
    embargo: 90,
  });
  step("vendor opened an inbox", { inbox: inboxTx.entityKey, tx: inboxTx.txHash, by: vendorAcct.address });
  inbox = (await getOne<InboxPayload>(pub, inboxTx.entityKey))!;
}

// ---------- 2. researcher files ----------
const researcherAcct = account("SEED_RESEARCHER_1");
const researcher = wallet("SEED_RESEARCHER_1");
const selfKey = keysFromSignature(await researcherAcct.signMessage({ message: KEY_MESSAGE })).selfPrivateKey;
const advisory = {
  title: "Withdrawal proofs can be replayed across epochs",
  component: "bridge/verifier · verifyWithdrawal()",
  severity: 4 as const,
  cwe: "CWE-294",
  summary: "A withdrawal proof accepted in one epoch is accepted again in the next, because the epoch is not part of the signed message.",
  researcher: "anon-7 (synthetic)",
};
const filed = await fileCase(researcher, pub, {
  report: {
    advisory,
    details: "Synthetic test report. The verifier hashes (recipient, amount, nonce) but not the epoch id.",
    impact: "Any withdrawal can be claimed twice across an epoch boundary.",
    reproduction: "1. Withdraw in epoch N. 2. Resubmit the same proof in epoch N+1.",
    contact: "anon-7",
  },
  advisory,
  poc: "synthetic proof of concept, kept off Arkiv",
  inbox: { key: inbox.key, creator: inbox.creator, payload: inbox.payload, expiresAt: inbox.expiresAt, permissionlessExtension: inbox.permissionlessExtension },
  watchers: refs,
  k: 2,
  researcherSelfKey: selfKey,
  embargoSeconds: EMBARGO,
});
step("researcher filed the case in one batch", {
  case: filed.caseKey,
  clock: filed.clockKey,
  triggers: filed.triggerKeys,
  deadlineBlock: filed.deadlineBlock,
  tx: filed.txHash,
  postageTx: filed.postageTx,
  by: researcherAcct.address,
});
if (filed.postageTx) await pub.waitForTransactionReceipt({ hash: filed.postageTx });

// ---------- 3. vendor finds it ----------
const cases = await fetchAll<CasePayload>(pub, [app(), kindIs("case")], { maxPages: 3 });
const mine = scanForVendor(cases, vkeys);
const match = mine.find((m) => m.caseEntity.key.toLowerCase() === filed.caseKey.toLowerCase());
if (!match) throw new Error("vendor could not find its own case");
step("vendor found the case by trial-decryption", { scanned: cases.length, matched: mine.length, title: match.match.report.advisory.title });
const responderKey = stealthPrivateKey(vkeys.spendingPrivateKey, match.match.hashedSharedSecret);
const responder = walletFor(responderKey);
step("vendor derived the one-time responder", { responder: privateKeyToAccount(responderKey).address, matchesCase: privateKeyToAccount(responderKey).address === filed.sealed.responder });

// ---------- 4. vendor acknowledges and asks for more time ----------
const ack = await vendorAct(responder, filed.caseKey, filed.sealed.payload, "ack", { note: "Received. Triaging now." });
step("vendor acknowledged (from the responder)", { entity: ack.entityKey, tx: ack.txHash });
const req = await vendorAct(responder, filed.caseKey, filed.sealed.payload, "extreq", { seconds: GRANT, note: "Patch is in review, need a little more time." });
step("vendor asked for more time", { entity: req.entityKey, tx: req.txHash, seconds: GRANT });

// ---------- 5. refusals: the vendor cannot move the deadline, nobody can touch the sealed file ----------
const head = await pub.getBlockNumber();
const refusals = [
  await expectRevert("vendor tries to extend the clock itself", () =>
    responder.extendEntity({ entityKey: filed.clockKey, expires: ExpirationTime.atBlock(head + 100_000n) }, { gas: 300_000n }),
  ),
  await expectRevert("vendor tries to delete the clock", () => responder.deleteEntity({ entityKey: filed.clockKey }, { gas: 300_000n })),
  await expectRevert("researcher tries to edit the sealed case file", () =>
    researcher.patchEntity({ entityKey: filed.caseKey, set: { sev: A.u64(1) } }, { gas: 300_000n }),
  ),
  await expectRevert("researcher tries to delete the sealed case file", () => researcher.deleteEntity({ entityKey: filed.caseKey }, { gas: 300_000n })),
];
for (const r of refusals) step(`refused: ${r.label}`, { reverted: r.reverted, error: r.error, tx: r.txHash });

// ---------- 6. researcher grants the extension: clock + triggers + record in one batch ----------
let bundle = (await loadCase(pub, filed.caseKey))!;
const grant = await grantExtension(researcher, bundle, { seconds: GRANT, request: req.entityKey });
step("researcher granted the extension in one batch", { tx: grant.txHash, seconds: GRANT });

// ---------- 7. forgeries: things anyone can write, none of which count ----------
const impostorAcct = account("SEED_IMPOSTOR");
const impostor = wallet("SEED_IMPOSTOR");
const rec = (kind: Parameters<typeof baseAttrs>[0], payload: unknown, extra: Record<string, ReturnType<typeof str>> = {}) => ({
  payload: encodePayload(payload),
  contentType: "application/json",
  attributes: { ...baseAttrs(kind), case: A.key(filed.caseKey), ...extra },
  // The forged acts live as long as a month, so the case page keeps showing them ignored to anyone
  // who opens it later, not only during the run.
  expires: ExpirationTime.fromDays(30),
});
const decoyClock = await impostor.createEntity({ ...rec("clock", { v: 1 }), expires: ExpirationTime.fromHours(6) });
const forged = await impostor.executeBatch({
  creates: [
    rec("ack", { v: 1 }),
    rec("fixed", { v: 1 }),
    rec("receipt", { v: 1, outcome: "lapsed", share: bytesToHex(randomBytes(33)), observed: { head: "0", expiresAt: "0" } }, { outcome: A.str("lapsed") }),
    rec("reveal", { v: 1, key: bytesToHex(randomBytes(32)), by: "watchers" }),
    // The trigger-copy attack: the real watcher-1 share ciphertext, re-aimed at a clock that lapses sooner.
    {
      payload: encodePayload(filed.sealed.triggers[0]!.payload),
      contentType: "application/json",
      attributes: { ...baseAttrs("trigger"), case: A.key(filed.caseKey), target: A.key(decoyClock.entityKey), watcher: A.addr(refs[0]!.address), action: A.str("release") },
      expires: ExpirationTime.fromMinutes(30),
    },
  ],
});
step("impostor wrote a fake ack, fake fix, fake receipt, fake reveal, a decoy clock and a copied trigger", {
  tx: forged.txHash,
  decoyClockTx: decoyClock.txHash,
  entities: forged.createdEntities,
  by: impostorAcct.address,
});

bundle = (await loadCase(pub, filed.caseKey))!;
step("case as derived from Arkiv after the forgeries", {
  status: bundle.view.status,
  ackedAt: bundle.view.ackedAt,
  extensionsGranted: bundle.view.extensions.granted,
  ignored: bundle.view.ignored.map((t) => `${t.kind}: ${t.reason}`),
  clockLive: bundle.view.clock.live,
  clockOwner: bundle.view.clock.owner,
  deadline: bundle.view.clock.expiresAt,
});

// ---------- 8. vendor marks it fixed; the deadline still arrives ----------
const fixed = await vendorAct(responder, filed.caseKey, filed.sealed.payload, "fixed", { note: "Patched in v2.4.1." });
step("vendor marked it fixed", { entity: fixed.entityKey, tx: fixed.txHash });

// ---------- 9. wait for the lapse and the watchers ----------
const deadline = bundle.view.clock.expiresAt;
log("waiting for the deadline", { deadline, secondsLeft: Number(deadline - (await pub.getBlockNumber())) * 2 });
let final = bundle;
const giveUp = Date.now() + 8 * 60_000 + Number(deadline - (await pub.getBlockNumber())) * 2_000;
while (Date.now() < giveUp) {
  await sleep(6_000);
  final = (await loadCase(pub, filed.caseKey))!;
  if (final.view.status === "revealed") break;
  if (!final.view.clock.live) log("clock is gone", { status: final.view.status, receipts: final.view.receipts.valid });
}
const reveal = await resolveReveal(pub, final);
const receipts = final.related.filter((e) => e.kind === "receipt").map((e) => ({ key: e.key, by: e.creator, block: e.createdAt, outcome: e.attrs.outcome }));
step("final state", {
  status: final.view.status,
  attribution: final.view.attribution,
  vendor: final.view.vendor?.name,
  receipts,
  revealEntity: final.view.reveal?.key,
  revealOk: reveal?.ok,
  checks: reveal?.checks,
  advisoryTitle: reveal?.advisory?.title,
  premature: final.view.receipts.premature,
  foreign: final.view.receipts.foreign,
});
step("watcher rejections", { rejections });

for (const w of running) w.stop();
proof.finishedAt = new Date().toISOString();
proof.links = {
  case: ent(filed.caseKey),
  clock: ent(filed.clockKey),
  filing: tx(filed.txHash),
  grant: tx(grant.txHash),
  refusals: refusals.filter((r) => r.txHash).map((r) => ({ label: r.label, tx: tx(String(r.txHash)) })),
};
proof.config = { embargoSeconds: EMBARGO, grantSeconds: GRANT, k: 2, n: 3, deployedWatchers: deployed, accessKey: !!cfg.accessKey };
const file = saveProof(`e2e-${Date.now()}`, proof);
log("proof written", { file, status: final.view.status });
process.exit(final.view.status === "revealed" && reveal?.ok ? 0 : 1);

