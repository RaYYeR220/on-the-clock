import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { currentInboxes } from "../src/read.js";
import type { InboxPayload, OtcEntity } from "../src/types.js";

const V1 = "0x1000000000000000000000000000000000000001" as Address;
const V2 = "0x2000000000000000000000000000000000000002" as Address;
let seq = 0;

function inbox(creator: Address, name: string, createdAt: number): OtcEntity<InboxPayload> {
  return {
    key: `0x${(++seq).toString(16).padStart(64, "0")}` as Hex,
    kind: "inbox",
    creator,
    owner: creator,
    createdAt: BigInt(createdAt),
    expiresAt: BigInt(createdAt + 1_000_000),
    readonly: true,
    permissionlessExtension: true,
    attrs: { app: "onclock", kind: "inbox" },
    payload: { v: 1, name, meta: "st:eth:0x", policy: "", sla: 7, embargo: 90 } as InboxPayload,
    payloadBytes: 0,
  };
}

describe("currentInboxes", () => {
  it("keeps the newest inbox per vendor and name, newest first", () => {
    const old = inbox(V1, "Halcyon", 10);
    const renewed = inbox(V1, "Halcyon", 30);
    const other = inbox(V1, "Halcyon Labs", 20);
    const second = inbox(V2, "Halcyon", 5);
    expect(currentInboxes([old, second, renewed, other]).map((i) => i.key)).toEqual([renewed.key, other.key, second.key]);
  });

  it("never lets one vendor's inbox stand in for another's of the same name", () => {
    const a = inbox(V1, "Same", 1);
    const b = inbox(V2, "Same", 2);
    expect(currentInboxes([a, b])).toHaveLength(2);
  });
});
