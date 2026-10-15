import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { Watcher, type Job } from "../src/watcher.js";

// Scheduling only: the chain reads behind the threshold check are stubbed out, so these tests pin
// down what a watcher does with their answers.

const ADDRESS = "0x5000000000000000000000000000000000000005";
const CASE = `0x${"aa".repeat(32)}` as Hex;
const CLOCK = `0x${"bb".repeat(32)}` as Hex;
const DEADLINE = 1_000n;
const REVEAL = { payload: new Uint8Array(), contentType: "application/json", attributes: {}, expires: {} };

type Threshold = { settled: boolean; create?: unknown };

function setup(answers: Threshold[]) {
  let head = DEADLINE + 2n;
  const executeBatch = vi.fn(async (_: { creates: unknown[] }) => ({ txHash: `0x${"cd".repeat(32)}` as Hex }));
  const w = new Watcher({
    pub: { getBlockNumber: async () => head } as never,
    wallet: { account: { address: ADDRESS }, executeBatch } as never,
    encryptionKey: `0x${"11".repeat(32)}`,
    operator: "test",
    region: "test",
    version: "test",
    log: () => {},
  });
  const threshold = vi.fn(async (): Promise<Threshold> => answers.shift() ?? { settled: false });
  Object.assign(w, { revealIfThreshold: threshold });
  const job: Job = { caseKey: CASE, clockKey: CLOCK, triggerKey: CASE, share: "0x01", filedDeadline: DEADLINE, expiresAt: DEADLINE, state: "due" };
  w.jobs.set(CASE, job);
  const publish = (w as unknown as { publish: (j: Job, o: string, h: bigint, a?: bigint) => Promise<void> }).publish.bind(w);
  return { w, job, executeBatch, threshold, publish, setHead: (h: bigint) => (head = h) };
}

describe("watcher reveal duty", () => {
  it("writes the reveal with its receipt when its share completes the threshold", async () => {
    const t = setup([{ settled: false, create: REVEAL }]);
    await t.publish(t.job, "lapsed", DEADLINE + 2n, DEADLINE - 1n);
    expect(t.executeBatch.mock.calls[0]![0].creates).toHaveLength(2);
    expect(t.job.state).toBe("done");
    expect(t.job.revealTx).toBeDefined();
  });

  it("finishes the reveal later when k watchers published in the same block", async () => {
    // Below threshold at publish time: the other watcher's receipt is in the same block.
    const t = setup([{ settled: false }, { settled: false, create: REVEAL }]);
    await t.publish(t.job, "lapsed", DEADLINE + 2n, DEADLINE - 1n);
    expect(t.executeBatch.mock.calls[0]![0].creates).toHaveLength(1);
    expect(t.job.state).toBe("revealing");

    // Not before the retry block.
    t.setHead(t.job.retryAt! - 1n);
    await t.w.tick();
    expect(t.threshold).toHaveBeenCalledTimes(1);

    t.setHead(t.job.retryAt!);
    await t.w.tick();
    expect(t.executeBatch).toHaveBeenCalledTimes(2);
    expect(t.executeBatch.mock.calls[1]![0].creates).toEqual([REVEAL]);
    expect(t.job.state).toBe("done");
  });

  it("stands down without writing when someone else already revealed", async () => {
    const t = setup([{ settled: false }, { settled: true }]);
    await t.publish(t.job, "lapsed", DEADLINE + 2n, DEADLINE - 1n);
    t.setHead(t.job.retryAt!);
    await t.w.tick();
    expect(t.executeBatch).toHaveBeenCalledTimes(1);
    expect(t.job.state).toBe("done");
  });

  it("gives up after a day without the threshold", async () => {
    const t = setup([{ settled: false }]);
    await t.publish(t.job, "lapsed", DEADLINE + 2n, DEADLINE - 1n);
    t.setHead(DEADLINE + 43_201n);
    await t.w.tick();
    expect(t.threshold).toHaveBeenCalledTimes(1);
    expect(t.job.state).toBe("done");
  });

  it("never writes a reveal for a withdrawn case", async () => {
    const t = setup([]);
    await t.publish(t.job, "withdrawn", DEADLINE + 2n);
    expect(t.threshold).not.toHaveBeenCalled();
    expect(t.job.state).toBe("done");
  });
});

describe("watcher query budget", () => {
  const limited = () => Object.assign(new Error("HTTP request failed. Status: 429"), { status: 429 });

  it("pauses queries after a 429 and backs off when it repeats", async () => {
    const t = setup([]);
    const handleDue = vi.fn(async () => {
      throw limited();
    });
    Object.assign(t.w, { handleDue });
    await t.w.tick();
    expect(handleDue).toHaveBeenCalledTimes(1);
    expect(t.w.quiet).toBe(true);
    await t.w.tick();
    expect(handleDue).toHaveBeenCalledTimes(1);

    const w = t.w as unknown as { quietUntil: number; quietMs: number };
    w.quietUntil = 0;
    await t.w.tick();
    expect(handleDue).toHaveBeenCalledTimes(2);
    expect(w.quietMs).toBe(60_000);
  });

  it("keeps working the other jobs when one fails for another reason", async () => {
    const t = setup([]);
    const other: Job = { ...t.job, caseKey: `0x${"ee".repeat(32)}` as Hex, clockKey: `0x${"ff".repeat(32)}` as Hex };
    t.w.jobs.set(other.caseKey, other);
    const handleDue = vi.fn(async (job: Job) => {
      if (job.caseKey === CASE) throw new Error("node hiccup");
    });
    Object.assign(t.w, { handleDue });
    await t.w.tick();
    expect(handleDue).toHaveBeenCalledTimes(2);
    expect(t.w.quiet).toBe(false);
  });

  it("rescans when a filing seals entities, not on every creation on the network", async () => {
    vi.useFakeTimers();
    try {
      let handlers: Record<string, (ev: Record<string, unknown>) => void> = {};
      const t = setup([]);
      Object.assign(t.w, { o: { ...(t.w as unknown as { o: object }).o, live: { watchEntityEvents: (h: typeof handlers) => ((handlers = h), () => {}) } } });
      const rescan = vi.fn(async () => {});
      Object.assign(t.w, { rescan });
      (t.w as unknown as { subscribe: () => void }).subscribe();
      expect(handlers.onEntityCreated).toBeUndefined();
      handlers.onOwnershipTransferred!({ entityKey: CASE, newOwner: "0x1111111111111111111111111111111111111111" });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(rescan).not.toHaveBeenCalled();
      for (const k of [CASE, CLOCK]) handlers.onOwnershipTransferred!({ entityKey: k, newOwner: "0x000000000000000000000000000000000000dead" });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(rescan).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks a pending reveal less often the longer it waits", async () => {
    const t = setup([{ settled: false }, { settled: false }, { settled: false }, { settled: false }]);
    await t.publish(t.job, "lapsed", DEADLINE + 2n, DEADLINE - 1n);
    const gaps: bigint[] = [];
    for (let i = 0; i < 3; i++) {
      const at = t.job.retryAt!;
      t.setHead(at);
      await t.w.tick();
      gaps.push(t.job.retryAt! - at);
    }
    expect(gaps[1]! - gaps[0]!).toBe(15n);
    expect(gaps[2]! - gaps[1]!).toBe(30n);
  });
});
