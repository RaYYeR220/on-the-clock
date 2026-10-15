// The watcher: turns an absence into a signed fact.
//
// Arkiv emits no event when an entity's lifetime runs out. A watcher holds one encrypted share per
// case, follows the clock over WebSocket (extensions move its schedule, a delete means withdrawal),
// and at the deadline proves the clock lapsed on its own: alive one block before expiry, gone now,
// and no delete in the logs. Then it publishes its share in a receipt. The watcher that brings the
// count to k also publishes the reveal in the same batch. When k watchers publish in the same block,
// none of them sees the threshold yet, so each one keeps checking and writes the reveal once it can.
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
import { deriveCase, isCaseClock } from "./state.js";
import type { CasePayload, OtcEntity, ReceiptPayload, TriggerPayload, WatcherPayload } from "./types.js";

export const ARKIV_ADDRESS: Address = "0x4400000000000000000000000000000000000044";
const ENTITY_DELETED = ENTITY_EVENTS_ABI.find((e) => e.name === "EntityDeleted")!;
const JSON_TYPE = "application/json";

export type JobState = "armed" | "due" | "deleted" | "revealing" | "done" | "failed";

/** How often a watcher whose receipt went out without the reveal checks the threshold again (30 s). */
const REVEAL_RETRY_BLOCKS = 15n;
/** How long it keeps checking before giving up on writing the reveal itself. */
const REVEAL_PATIENCE_SECONDS = 86_400;

export interface Job {
  caseKey: Hex;
  clockKey: Hex;
  triggerKey: Hex;
  share: Hex;
  /** The deadline written into the case file at filing. Nothing is released before it, whatever else says. */
  filedDeadline: bigint;
  expiresAt: bigint;
  state: JobState;
  deletedAt?: bigint;
  outcome?: Outcome;
  receiptTx?: Hex;
  revealTx?: Hex;
  /** "revealing" only: the next block at which to check the threshold again. */
  retryAt?: bigint;
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
  /** One job per case, keyed by case key. */
  readonly jobs = new Map<string, Job>();
  private readonly byClock = new Map<string, string>();
  private readonly rejected = new Set<string>();
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

  /**
   * A trigger is only a job if the case file vouches for it: same author as the case, aimed at the
   * clock the case committed to, and naming this watcher's key. Anyone can write an entity that
   * looks like a trigger; only the researcher's own, filed in the case's batch, passes.
   */
  private async addTrigger(t: OtcEntity): Promise<boolean> {
    if (this.rejected.has(t.key.toLowerCase())) return false;
    const caseKey = String(t.attrs.case).toLowerCase() as Hex;
    const existing = this.jobs.get(caseKey);
    if (existing?.triggerKey.toLowerCase() === t.key.toLowerCase()) return false;
    // A second trigger for a case we already follow is still checked, so a copy is refused on the
    // record rather than skipped without a trace.
    const reject = (reason: string) => {
      this.rejected.add(t.key.toLowerCase());
      this.log("trigger rejected", { trigger: t.key, reason });
      return false;
    };
    const caseEntity = await getOne<CasePayload>(this.o.pub, caseKey);
    if (!caseEntity || caseEntity.kind !== "case") return reject("no case file behind it");
    const p = caseEntity.payload;
    if (t.creator.toLowerCase() !== caseEntity.creator.toLowerCase()) return reject("not written by the case's researcher");
    const clockKey = p.clock.toLowerCase() as Hex;
    if (String(t.attrs.target).toLowerCase() !== clockKey) return reject("aimed at a different clock than the case file names");
    const me = p.watchers.find((w) => w.address.toLowerCase() === this.address.toLowerCase());
    if (!me || me.pubkey.toLowerCase() !== this.pubkey.toLowerCase()) return reject("the case file does not name this watcher's key");
    let share: Hex;
    try {
      share = openShare(caseKey, clockKey, t.payload as TriggerPayload, this.address, this.o.encryptionKey);
    } catch {
      return reject("share does not open for this case, clock and watcher");
    }
    if (existing) {
      // Genuine but redundant: keep the job we have and stop re-checking this one.
      this.rejected.add(t.key.toLowerCase());
      return false;
    }
    const job: Job = { caseKey, clockKey, triggerKey: t.key, share, filedDeadline: BigInt(p.deadlineBlock), expiresAt: BigInt(p.deadlineBlock), state: "armed" };
    const done = await this.myReceipt(caseKey);
    if (done) {
      job.outcome = (done.payload as ReceiptPayload).outcome;
      // A lapse we already reported may still be waiting for its reveal (we restarted mid-way).
      job.state = job.outcome === "lapsed" ? "revealing" : "done";
    } else {
      const clock = await getOne(this.o.pub, clockKey);
      if (isCaseClock(caseEntity, clock)) job.expiresAt = clock.expiresAt;
      else job.state = "due";
    }
    this.jobs.set(caseKey, job);
    this.byClock.set(clockKey, caseKey);
    return true;
  }

  private jobForClock(clockKey: Hex): Job | undefined {
    const c = this.byClock.get(clockKey.toLowerCase());
    return c ? this.jobs.get(c) : undefined;
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
        const job = this.jobForClock(ev.entityKey);
        if (!job || job.state === "done") return;
        job.expiresAt = ev.expiresAt;
        job.state = "armed";
        this.log("clock extended, rescheduled", { clock: ev.entityKey, expiresAt: ev.expiresAt.toString(), block: ev.blockNumber.toString() });
      },
      onEntityDeleted: (ev) => {
        const job = this.jobForClock(ev.entityKey);
        if (!job || job.state === "done") return;
        job.state = "deleted";
        job.deletedAt = ev.blockNumber;
        this.log("clock deleted before its deadline", { clock: ev.entityKey, block: ev.blockNumber.toString() });
      },
      onOwnershipTransferred: (ev) => {
        if (this.jobForClock(ev.entityKey)) {
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
        if (job.state === "armed" && head >= job.expiresAt && head >= job.filedDeadline) job.state = "due";
        if (job.state === "due") await this.handleDue(job, head);
        else if (job.state === "revealing") await this.completeReveal(job, head);
        else if (job.state === "deleted" && job.deletedAt !== undefined && head > job.deletedAt) await this.handleDeleted(job, head);
      }
    } finally {
      this.busy = false;
    }
  }

  /** The clock has passed its expiry. Prove it lapsed on its own before releasing anything. */
  private async handleDue(job: Job, head: bigint) {
    const { pub } = this.o;
    if (head < job.filedDeadline || head < job.expiresAt) {
      job.state = "armed";
      return;
    }
    const clock = await getOne(pub, job.clockKey);
    if (clock) {
      // Extended in the meantime (or the node has not caught up): never release early.
      job.expiresAt = clock.expiresAt;
      job.state = clock.expiresAt > head ? "armed" : "due";
      return;
    }
    const aliveAt = job.expiresAt - 1n;
    const before = (await fetchAll(pub, [app(), eq("$key", key(job.clockKey))], { atBlock: aliveAt })).filter(
      (e) => e.kind === "clock" && String(e.attrs.case).toLowerCase() === job.caseKey.toLowerCase(),
    );
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
    let waiting = false;
    if (outcome === "lapsed") {
      const t = await this.revealIfThreshold(job, head);
      if (t.create) creates!.push(t.create);
      else waiting = !t.settled;
    }
    const res = await wallet.executeBatch({ creates });
    job.state = waiting ? "revealing" : "done";
    if (waiting) job.retryAt = head + this.retryOffset();
    job.outcome = outcome;
    job.receiptTx = res.txHash;
    if ((creates?.length ?? 0) > 1) job.revealTx = res.txHash;
    this.log(`receipt published: ${outcome}`, { case: job.caseKey, tx: res.txHash, withReveal: (creates?.length ?? 0) > 1 });
  }

  /**
   * If the shares on record plus ours reach the threshold, build the reveal so it lands in the same
   * batch as the receipt. `settled` means there is nothing left to do: a valid reveal already exists,
   * or the case file is gone.
   */
  private async revealIfThreshold(job: Job, head: bigint): Promise<{ settled: boolean; create?: ReturnType<typeof revealCreate> }> {
    const { pub } = this.o;
    const caseEntity = await getOne<CasePayload>(pub, job.caseKey);
    if (!caseEntity) return { settled: true };
    const related = await fetchAll(pub, [app(), eq("case", key(job.caseKey))]);
    const view = deriveCase({ caseEntity, related: related.filter((e) => e.kind !== "clock"), clock: null, head });
    if (view.reveal) return { settled: true };
    const shares = [...new Set([...view.shares, job.share].map((s) => s.toLowerCase() as Hex))];
    if (shares.length < view.k) return { settled: false };
    const k = await reconstruct(job.caseKey, caseEntity.payload, shares);
    if (!k) return { settled: false };
    const check = verifyRevealKey(job.caseKey, caseEntity.payload, k);
    if (!check.ok || !check.bundle) {
      this.log("reconstructed key failed verification; not revealing", { case: job.caseKey, checks: check.checks });
      return { settled: false };
    }
    return { settled: false, create: revealCreate(job.caseKey, k, "watchers", check.bundle.vendor, check.bundle.inbox) };
  }

  /** Our receipt went out before the threshold was visible. Write the reveal once it is, unless someone already has. */
  private async completeReveal(job: Job, head: bigint) {
    if (job.retryAt !== undefined && head < job.retryAt) return;
    if (head > job.expiresAt + blocks(REVEAL_PATIENCE_SECONDS)) {
      job.state = "done";
      return;
    }
    job.retryAt = head + this.retryOffset();
    const t = await this.revealIfThreshold(job, head);
    if (t.create) {
      const res = await this.o.wallet.executeBatch({ creates: [t.create] });
      job.revealTx = res.txHash;
      job.state = "done";
      this.log("reveal published", { case: job.caseKey, tx: res.txHash });
    } else if (t.settled) {
      job.state = "done";
    }
  }

  /** Watchers that missed the threshold together retry a few blocks apart, so one reveal is usually enough. */
  private retryOffset() {
    return REVEAL_RETRY_BLOCKS + (BigInt(`0x${this.address.slice(-2)}`) % 8n);
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
