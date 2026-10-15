import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { deriveCase } from "../src/state.js";
import type { Kind } from "../src/constants.js";
import type { CasePayload, OtcEntity } from "../src/types.js";

const R = "0x1000000000000000000000000000000000000001" as Address; // researcher
const V = "0x2000000000000000000000000000000000000002" as Address; // responder (vendor, stealth)
const C = "0x3000000000000000000000000000000000000003" as Address; // coordinator
const X = "0x4000000000000000000000000000000000000004" as Address; // impostor
const W1 = "0x5000000000000000000000000000000000000005" as Address;
const W2 = "0x6000000000000000000000000000000000000006" as Address;
const W3 = "0x7000000000000000000000000000000000000007" as Address;

const CASE = `0x${"aa".repeat(32)}` as Hex;
const CLOCK = `0x${"bb".repeat(32)}` as Hex;
let seq = 0;
const k = () => `0x${(++seq).toString(16).padStart(64, "0")}` as Hex;

function ent<P>(kind: Kind, creator: Address, createdAt: number, payload: P, attrs: Record<string, string | bigint> = {}, key = k()): OtcEntity<P> {
  return {
    key,
    kind,
    creator,
    owner: creator,
    createdAt: BigInt(createdAt),
    expiresAt: BigInt(createdAt + 1_000_000),
    readonly: true,
    permissionlessExtension: false,
    attrs: { app: "onclock", kind, ...attrs },
    payload,
    payloadBytes: 100,
  };
}

const casePayload = {
  v: 1,
  eph: "0x02",
  vt: 7,
  responder: V,
  vcommit: "0x00",
  vendorBox: "0x00",
  selfBox: { e: "0x02", c: "0x00" },
  researcherKey: "0x02",
  advisoryBox: "0x00",
  reportHash: "0x00",
  pocHash: "0x00",
  watchers: [W1, W2, W3].map((address) => ({ address, pubkey: "0x02" })),
  k: 2,
  clock: CLOCK,
  deadlineBlock: "1000",
  deadlineAt: 0,
} as unknown as CasePayload;

const theCase = ent("case", R, 100, casePayload, { sev: 4n }, CASE);
const clock = (owner: Address = R, expiresAt = 1000) => ({
  ...ent("clock", R, 100, {}, { case: CASE }, CLOCK),
  owner,
  expiresAt: BigInt(expiresAt),
});
const on = { case: CASE };

describe("deriveCase", () => {
  it("a fresh case is sealed, with the deadline read from the live clock", () => {
    const v = deriveCase({ caseEntity: theCase, related: [], clock: clock(), head: 200n });
    expect(v.status).toBe("sealed");
    expect(v.clock.live).toBe(true);
    expect(v.clock.expiresAt).toBe(1000n);
    expect(v.blocksLeft).toBe(800n);
  });

  it("only the responder's acknowledgement counts; an impostor's is listed as ignored", () => {
    const fake = ent("ack", X, 150, { v: 1 }, on);
    const real = ent("ack", V, 160, { v: 1 }, on);
    const v = deriveCase({ caseEntity: theCase, related: [fake, real], clock: clock(), head: 200n });
    expect(v.status).toBe("acknowledged");
    expect(v.ackedAt).toBe(160n);
    expect(v.timeline.find((t) => t.key === fake.key)?.verdict).toBe("ignored");
    expect(v.timeline.find((t) => t.key === real.key)?.verdict).toBe("verified");
    expect(v.ignored).toHaveLength(1);
  });

  it("extensions count only when granted by the current custodian chain", () => {
    const req = ent("extreq", V, 170, { v: 1 }, { ...on, seconds: 2_592_000n });
    const grant = ent("grant", R, 180, { v: 1, expiresAt: "2000" }, { ...on, seconds: 2_592_000n });
    const handoff = ent("handoff", R, 190, { v: 1 }, { ...on, to: C });
    const grant2 = ent("grant", C, 200, { v: 1, expiresAt: "3000" }, { ...on, seconds: 1_209_600n });
    const rogue = ent("grant", V, 210, { v: 1, expiresAt: "9000" }, { ...on, seconds: 31_536_000n });
    const v = deriveCase({ caseEntity: theCase, related: [req, grant, handoff, grant2, rogue], clock: clock(C, 3000), head: 250n });
    expect(v.extensions.granted).toBe(2);
    expect(v.extensions.seconds).toBe(44 * 86_400);
    expect(v.extensions.requested).toBe(1);
    expect(v.custodian).toBe(C);
    expect(v.timeline.find((t) => t.key === rogue.key)?.verdict).toBe("ignored");
  });

  it("a grant from the researcher after handing off is no longer authoritative", () => {
    const handoff = ent("handoff", R, 190, { v: 1 }, { ...on, to: C });
    const late = ent("grant", R, 200, { v: 1, expiresAt: "5000" }, { ...on, seconds: 5_184_000n });
    const v = deriveCase({ caseEntity: theCase, related: [handoff, late], clock: clock(C), head: 250n });
    expect(v.extensions.granted).toBe(0);
    expect(v.timeline.find((t) => t.key === late.key)?.verdict).toBe("ignored");
  });

  it("after the deadline with no receipts the case is lapsed, awaiting watchers", () => {
    const v = deriveCase({ caseEntity: theCase, related: [], clock: null, head: 1200n });
    expect(v.status).toBe("lapsed");
    expect(v.clock.live).toBe(false);
  });

  it("k valid lapse receipts make the case revealable; foreign and premature receipts don't count", () => {
    const r1 = ent("receipt", W1, 1001, { v: 1, outcome: "lapsed", share: "0x01", observed: { head: "1001", expiresAt: "1000" } }, { ...on, outcome: "lapsed" });
    const early = ent("receipt", W2, 900, { v: 1, outcome: "lapsed", share: "0x02", observed: { head: "900", expiresAt: "1000" } }, { ...on, outcome: "lapsed" });
    const forged = ent("receipt", X, 1002, { v: 1, outcome: "lapsed", share: "0x03", observed: { head: "1002", expiresAt: "1000" } }, { ...on, outcome: "lapsed" });
    const one = deriveCase({ caseEntity: theCase, related: [r1, early, forged], clock: null, head: 1100n });
    expect(one.status).toBe("lapsed");
    expect(one.receipts.valid).toBe(1);
    expect(one.receipts.premature).toEqual([W2]);
    expect(one.shares).toEqual(["0x01"]);
    const r3 = ent("receipt", W3, 1003, { v: 1, outcome: "lapsed", share: "0x04", observed: { head: "1003", expiresAt: "1000" } }, { ...on, outcome: "lapsed" });
    const two = deriveCase({ caseEntity: theCase, related: [r1, early, forged, r3], clock: null, head: 1100n });
    expect(two.status).toBe("revealable");
    expect(two.shares).toEqual(["0x01", "0x04"]);
  });

  it("the deadline a receipt is judged against follows granted extensions", () => {
    const grant = ent("grant", R, 500, { v: 1, expiresAt: "2000" }, { ...on, seconds: 2_592_000n });
    const tooEarly = ent("receipt", W1, 1500, { v: 1, outcome: "lapsed", share: "0x01", observed: { head: "1500", expiresAt: "1000" } }, { ...on, outcome: "lapsed" });
    const v = deriveCase({ caseEntity: theCase, related: [grant, tooEarly], clock: null, head: 2100n });
    expect(v.expectedExpiry).toBe(2000n);
    expect(v.receipts.premature).toEqual([W1]);
  });

  it("a clock gone before its deadline reads as withdrawn; a reveal whose key opens nothing is ignored", () => {
    const wd = ent("receipt", W1, 600, { v: 1, outcome: "withdrawn", observed: { head: "600", expiresAt: "1000" } }, { ...on, outcome: "withdrawn" });
    expect(deriveCase({ caseEntity: theCase, related: [wd], clock: null, head: 700n }).status).toBe("withdrawn");
    const bogus = ent("reveal", X, 590, { v: 1, key: `0x${"00".repeat(32)}`, by: "watchers" }, { ...on, by: "watchers" });
    const v = deriveCase({ caseEntity: theCase, related: [wd, bogus], clock: null, head: 700n });
    expect(v.status).toBe("withdrawn");
    expect(v.reveal).toBeUndefined();
    expect(v.timeline.find((t) => t.key === bogus.key)?.verdict).toBe("ignored");
  });

  it("one watcher claiming withdrawal cannot outvote k lapse receipts", () => {
    const lapsed = (w: Address, at: number, share: Hex) =>
      ent("receipt", w, at, { v: 1, outcome: "lapsed", share, observed: { head: String(at), expiresAt: "1000" } }, { ...on, outcome: "lapsed" });
    const liar = ent("receipt", W2, 1001, { v: 1, outcome: "withdrawn", observed: { head: "1001", expiresAt: "1000" } }, { ...on, outcome: "withdrawn" });
    const v = deriveCase({ caseEntity: theCase, related: [lapsed(W1, 1002, "0x01"), liar, lapsed(W3, 1003, "0x03")], clock: null, head: 1100n });
    expect(v.status).toBe("revealable");
    expect(v.receipts.withdrawn).toBe(1);
  });

  it("a forged clock that points at the case is not the case's clock", () => {
    const forged = { ...ent("clock", X, 150, {}, on), owner: X, expiresAt: 999_999n };
    const v = deriveCase({ caseEntity: theCase, related: [], clock: forged, head: 1200n });
    expect(v.clock.live).toBe(false);
    expect(v.status).toBe("lapsed");
    const wrongKey = { ...ent("clock", R, 150, {}, on), owner: R, expiresAt: 999_999n };
    expect(deriveCase({ caseEntity: theCase, related: [], clock: wrongKey, head: 1200n }).clock.live).toBe(false);
  });

  it("the timeline is chronological and starts with the filing", () => {
    const a = ent("ack", V, 300, { v: 1 }, on);
    const f = ent("fixed", V, 400, { v: 1 }, on);
    const v = deriveCase({ caseEntity: theCase, related: [f, a], clock: clock(), head: 450n });
    expect(v.timeline.map((t) => t.kind)).toEqual(["case", "ack", "fixed"]);
    expect(v.status).toBe("fixed");
  });
});
