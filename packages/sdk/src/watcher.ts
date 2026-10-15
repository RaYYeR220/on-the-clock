// The watcher: turns an absence into a signed fact.
//
// Arkiv emits no event when an entity's lifetime runs out. A watcher holds one encrypted share per
// case, follows the clock over WebSocket (extensions move its schedule, a delete means withdrawal),
// and at the deadline proves the clock lapsed on its own: alive one block before expiry, gone now,
// and no delete in the logs. Then it publishes its share in a receipt. The watcher that brings the
// count to k also publishes the reveal in the same batch.
import { ENTITY_EVENTS_ABI, ExpirationTime, type PublicArkivClient, type WalletArkivClient } from "@arkiv-network/sdk";
import { addr, key, str, u64 } from "@arkiv-network/sdk/attr";
import { eq } from "@arkiv-network/sdk/query";
import type { Address, Hex } from "viem";
import { blocks, revealCreate } from "./actions.js";
import { A, baseAttrs, encodePayload } from "./codec.js";
import { LIFETIME, type Outcome } from "./constants.js";
import { publicKeyOf } from "./crypto/box.js";
import { app, fetchAll, getOne, kindIs, listTriggersFor } from "./read.js";
import { openShare, reconstruct, verifyRevealKey } from "./seal.js";
import { deriveCase } from "./state.js";
import type { CasePayload, OtcEntity, ReceiptPayload, TriggerPayload, WatcherPayload } from "./types.js";

export const ARKIV_ADDRESS: Address = "0x4400000000000000000000000000000000000044";
const ENTITY_DELETED = ENTITY_EVENTS_ABI.find((e) => e.name === "EntityDeleted")!;
const JSON_TYPE = "application/json";

export type JobState = "armed" | "due" | "deleted" | "done" | "failed";

export interface Job {
  caseKey: Hex;
  clockKey: Hex;
  triggerKey: Hex;
  share: Hex;
  expiresAt: bigint;
  state: JobState;
  deletedAt?: bigint;
  outcome?: Outcome;
  receiptTx?: Hex;
  revealTx?: Hex;
  note?: string;
}

export interface WatcherOptions {
  pub: PublicArkivClient;
  live?: PublicArkivClient;
  wallet: WalletArkivClient;
  encryptionKey: Hex;
  operator: string;
  region: string;
  version: string;
  log?: (msg: string, data?: Record<string, unknown>) => void;
  tickMs?: number;
  rescanMs?: number;
}

export class Watcher {
  readonly address: Address;
  readonly pubkey: Hex;
  readonly jobs = new Map<string, Job>();
  leaseKey: Hex | null = null;
  lastHead = 0n;
  lastTickAt = 0;
  startedAt = Date.now();
  private timers: ReturnType<typeof setInterval>[] = [];
  private unwatch: (() => void) | null = null;
  private busy = false;
  private rescanQueued = false;

  constructor(private readonly o: WatcherOptions) {
    if (!o.wallet.account) throw new Error("watcher wallet has no account");
    this.address = o.wallet.account.address;
    this.pubkey = publicKeyOf(o.encryptionKey);
  }

  private log(msg: string, data?: Record<string, unknown>) {
    (this.o.log ?? ((m, d) => console.log(JSON.stringify({ t: new Date().toISOString(), msg: m, ...d }))))(msg, data);
  }

  async start() {
    await this.heartbeat();
    await this.rescan();
    this.subscribe();
    this.timers.push(setInterval(() => void this.heartbeat().catch((e) => this.log("heartbeat failed", { err: String(e) })), LIFETIME.watcherHeartbeat * 1000));
    this.timers.push(setInterval(() => void this.tick().catch((e) => this.log("tick failed", { err: String(e) })), this.o.tickMs ?? 4_000));
    this.timers.push(setInterval(() => void this.rescan().catch((e) => this.log("rescan failed", { err: String(e) })), this.o.rescanMs ?? 60_000));
    this.log("watcher started", { address: this.address, pubkey: this.pubkey, jobs: this.jobs.size });
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.unwatch?.();
    this.unwatch = null;
  }

  // ---------- liveness lease ----------

  async heartbeat() {
    const { pub, wallet } = this.o;
    const head = await pub.getBlockNumber();
    const until = head + blocks(LIFETIME.watcherLease);
    if (this.leaseKey && (await getOne(pub, this.leaseKey))) {
      await wallet.extendEntity({ entityKey: this.leaseKey, expires: ExpirationTime.atBlock(until) });
      return;
    }
    // Reuse a lease that is still alive from an earlier run, otherwise take out a new one.
    const mine = await fetchAll<WatcherPayload>(pub, [app(), kindIs("watcher")], { createdBy: this.address });
    const current = mine.find((m) => m.payload?.pubkey === this.pubkey);
    if (current) {
      this.leaseKey = current.key;
      await wallet.extendEntity({ entityKey: current.key, expires: ExpirationTime.atBlock(until) });
      return;
    }
    const payload: WatcherPayload = { v: 1, pubkey: this.pubkey, operator: this.o.operator, version: this.o.version };
    const r = await wallet.createEntity({
      payload: encodePayload(payload),
      contentType: JSON_TYPE,
      attributes: { ...baseAttrs("watcher"), op: A.str(this.o.operator), region: A.str(this.o.region) },
      expires: ExpirationTime.atBlock(until),
    });
    this.leaseKey = r.entityKey;
    this.log("lease created", { lease: r.entityKey, tx: r.txHash });
  }

  // ---------- jobs ----------

  /** Re-reads the job list from Arkiv. The chain is the only state a watcher needs to survive a restart. */
  async rescan() {
    const triggers = await listTriggersFor(this.o.pub, this.address);
    let added = 0;
    for (const t of triggers) if (await this.addTrigger(t)) added++;
    if (added) this.log("jobs added", { added, total: this.jobs.size });
  }

  private async addTrigger(t: OtcEntity): Promise<boolean> {
    const clockKey = String(t.attrs.target).toLowerCase() as Hex;
    if (this.jobs.has(clockKey)) return false;
    const caseKey = String(t.attrs.case) as Hex;
    let share: Hex;
    try {
      share = openShare(caseKey, t.payload as TriggerPayload, this.address, this.o.encryptionKey);
    } catch {
      this.log("trigger does not open with our key", { trigger: t.key });
      return false;
    }
    const job: Job = { caseKey, clockKey, triggerKey: t.key, share, expiresAt: 0n, state: "armed" };
    const done = await this.myReceipt(caseKey);
    if (done) {
      job.state = "done";
      job.outcome = (done.payload as ReceiptPayload).outcome;
      job.receiptTx = undefined;
    } else {
      const clock = await getOne(this.o.pub, clockKey);
      if (clock) job.expiresAt = clock.expiresAt;
      else {
        const c = await getOne<CasePayload>(this.o.pub, caseKey);
        job.expiresAt = c ? BigInt(c.payload.deadlineBlock) : 0n;
        job.state = "due";
      }
    }
    this.jobs.set(clockKey, job);
    return true;
  }

  private async myReceipt(caseKey: Hex) {
    const r = await fetchAll<ReceiptPayload>(this.o.pub, [app(), kindIs("receipt"), eq("case", key(caseKey))], { createdBy: this.address });
    return r[0] ?? null;
  }

  // ---------- live events ----------

  private subscribe() {
    if (!this.o.live) return;
    this.unwatch = this.o.live.watchEntityEvents({
      onExpiryExtended: (ev) => {
        const job = this.jobs.get(ev.entityKey.toLowerCase());
        if (!job || job.state === "done") return;
        job.expiresAt = ev.expiresAt;
        job.state = "armed";
        this.log("clock extended, rescheduled", { clock: ev.entityKey, expiresAt: ev.expiresAt.toString(), block: ev.blockNumber.toString() });
      },
      onEntityDeleted: (ev) => {
        const job = this.jobs.get(ev.entityKey.toLowerCase());
        if (!job || job.state === "done") return;
        job.state = "deleted";
        job.deletedAt = ev.blockNumber;
        this.log("clock deleted before its deadline", { clock: ev.entityKey, block: ev.blockNumber.toString() });
      },
      onOwnershipTransferred: (ev) => {
        if (this.jobs.has(ev.entityKey.toLowerCase())) {
          this.log("clock changed hands", { clock: ev.entityKey, to: ev.newOwner });
        }
      },
      onEntityCreated: () => {
        // Events carry no attributes. Rather than fetch every entity on the network, coalesce
        // creations into one job-list query.
        if (this.rescanQueued) return;
        this.rescanQueued = true;
        setTimeout(() => {
          this.rescanQueued = false;
          void this.rescan().catch((e) => this.log("rescan failed", { err: String(e) }));
        }, 3_000);
      },
      onError: (e) => this.log("event stream error", { err: e.message.split("\n")[0] }),
    });
  }

  // ---------- the schedule ----------

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const head = await this.o.pub.getBlockNumber();
      this.lastHead = head;
      this.lastTickAt = Date.now();
      for (const job of this.jobs.values()) {
        if (job.state === "armed" && job.expiresAt > 0n && head >= job.expiresAt) job.state = "due";
        if (job.state === "due") await this.handleDue(job, head);
        else if (job.state === "deleted" && job.deletedAt !== undefined && head > job.deletedAt) await this.handleDeleted(job, head);
      }
    } finally {
      this.busy = false;
    }
  }

  /** The clock has passed its expiry. Prove it lapsed on its own before releasing anything. */
  private async handleDue(job: Job, head: bigint) {
    const { pub } = this.o;
    const clock = await getOne(pub, job.clockKey);
    if (clock) {
      // Extended in the meantime (or the node has not caught up): never release early.
      job.expiresAt = clock.expiresAt;
      job.state = clock.expiresAt > head ? "armed" : "due";
      return;
    }
    const aliveAt = job.expiresAt - 1n;
    const before = await fetchAll(pub, [app(), eq("$key", key(job.clockKey))], { atBlock: aliveAt });
    const deletions = await pub.getLogs({
      address: ARKIV_ADDRESS,
      event: ENTITY_DELETED,
      args: { entityKey: job.clockKey },
      fromBlock: job.expiresAt > 2_000n ? job.expiresAt - 2_000n : 0n,
      toBlock: head,
    });
    if (deletions.length > 0 || before.length === 0) {
      job.state = "deleted";
      job.deletedAt = deletions[0]?.blockNumber ?? aliveAt;
      return;
    }
    await this.publish(job, "lapsed", head, aliveAt);
  }

  private async handleDeleted(job: Job, head: bigint) {
    const reveals = await fetchAll(this.o.pub, [app(), kindIs("reveal"), eq("case", key(job.caseKey)), eq("by", str("researcher"))]);
    await this.publish(job, reveals.length ? "disclosed" : "withdrawn", head);
  }

  private async publish(job: Job, outcome: Outcome, head: bigint, aliveAt?: bigint) {
    const { pub, wallet } = this.o;
    const payload: ReceiptPayload = {
      v: 1,
      outcome,
      ...(outcome === "lapsed" ? { share: job.share } : {}),
      observed: { head: head.toString(), expiresAt: job.expiresAt.toString(), ...(aliveAt !== undefined ? { aliveAt: aliveAt.toString() } : {}) },
    };
    const receipt = {
      payload: encodePayload(payload),
      contentType: JSON_TYPE,
      attributes: {
        ...baseAttrs("receipt"),
        case: key(job.caseKey),
        target: key(job.clockKey),
        outcome: str(outcome),
        at: u64(head),
      },
      expires: ExpirationTime.fromSeconds(LIFETIME.record),
      flags: { readonly: true, permissionlessExtension: true },
    };

    const creates: Parameters<WalletArkivClient["executeBatch"]>[0]["creates"] = [receipt];
    if (outcome === "lapsed") {
      const reveal = await this.revealIfThreshold(job, head);
      if (reveal) creates!.push(reveal);
    }
    const res = await wallet.executeBatch({ creates });
    job.state = "done";
    job.outcome = outcome;
    job.receiptTx = res.txHash;
    if ((creates?.length ?? 0) > 1) job.revealTx = res.txHash;
    this.log(`receipt published: ${outcome}`, { case: job.caseKey, tx: res.txHash, withReveal: (creates?.length ?? 0) > 1 });
  }

  /** If our share completes the threshold, build the reveal so it lands in the same batch as the receipt. */
  private async revealIfThreshold(job: Job, head: bigint) {
    const { pub } = this.o;
    const caseEntity = await getOne<CasePayload>(pub, job.caseKey);
    if (!caseEntity) return null;
    const related = await fetchAll(pub, [app(), eq("case", key(job.caseKey))]);
    const view = deriveCase({ caseEntity, related: related.filter((e) => e.kind !== "clock"), clock: null, head });
    if (view.reveal) return null;
    const shares = [...view.shares, job.share];
    if (new Set(shares.map((s) => s.toLowerCase())).size < view.k) return null;
    const k = await reconstruct(job.caseKey, caseEntity.payload, shares);
    if (!k) return null;
    const check = verifyRevealKey(job.caseKey, caseEntity.payload, k);
    if (!check.ok || !check.bundle) {
      this.log("reconstructed key failed verification; not revealing", { case: job.caseKey, checks: check.checks });
      return null;
    }
    return revealCreate(job.caseKey, k, "watchers", check.bundle.vendor, check.bundle.inbox);
  }

  status() {
    return {
      address: this.address,
      pubkey: this.pubkey,
      operator: this.o.operator,
      region: this.o.region,
      version: this.o.version,
      lease: this.leaseKey,
      head: this.lastHead.toString(),
      lastTickAt: this.lastTickAt ? new Date(this.lastTickAt).toISOString() : null,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      jobs: [...this.jobs.values()].map((j) => ({
        case: j.caseKey,
        clock: j.clockKey,
        state: j.state,
        expiresAt: j.expiresAt.toString(),
        outcome: j.outcome ?? null,
        receiptTx: j.receiptTx ?? null,
        revealTx: j.revealTx ?? null,
      })),
    };
  }
}

export { addr };
