import { afterEach, describe, expect, it, vi } from "vitest";
import { isRateLimited, publicClient } from "../src/client.js";

// The keyed transport steps aside after a 429 and the anonymous one behind it takes the call.

afterEach(() => vi.unstubAllGlobals());

function stubRpc(keyed: number) {
  const seen: { key: boolean }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const key = new Headers(init.headers).has("X-API-KEY");
      seen.push({ key });
      const body = JSON.parse(String(init.body)) as { id: number };
      if (key && keyed === 429) return new Response(JSON.stringify({ error: "QUOTA_EXCEEDED", message: "quota exhausted" }), { status: 429 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x10" }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return seen;
}

describe("access key transport", () => {
  it("uses the key while it has quota", async () => {
    const seen = stubRpc(200);
    expect(await publicClient({ accessKey: "k" }).getBlockNumber({ cacheTime: 0 })).toBe(16n);
    expect(seen.map((s) => s.key)).toEqual([true]);
  });

  it("falls back to the anonymous budget when the key's quota is spent, and stops asking the key", async () => {
    const seen = stubRpc(429);
    const pub = publicClient({ accessKey: "k" });
    expect(await pub.getBlockNumber({ cacheTime: 0 })).toBe(16n);
    expect(await pub.getBlockNumber({ cacheTime: 0 })).toBe(16n);
    expect(seen.map((s) => s.key)).toEqual([true, false, false]);
  });

  it("recognises a 429 anywhere in the cause chain", () => {
    expect(isRateLimited(new Error("outer", { cause: Object.assign(new Error("inner"), { status: 429 }) }))).toBe(true);
    expect(isRateLimited(new Error("ANON_COST_LIMITED"))).toBe(true);
    expect(isRateLimited(new Error("execution reverted"))).toBe(false);
  });
});
