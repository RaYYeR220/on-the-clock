// Read-only RPC relay with an access key. The app falls back to it only when the anonymous query
// budget is exhausted. It serves this site's pages only (same origin), forwards Arkiv reads only,
// and is rate limited per IP, so the key's quota cannot be borrowed by anyone else.
import { NextResponse } from "next/server";
import { Window, clientIp, sameOrigin } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getLogs",
  "eth_getTransactionReceipt",
  "arkiv_query",
  "arkiv_getEntity",
  "arkiv_getEntityCount",
]);
const MAX_BODY = 16_384;
const perIp = new Window(240, 60_000);

type RpcCall = { method?: string };
const refuse = (status: number, message: string) =>
  NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32601, message } }, { status });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return refuse(403, "this relay only serves the On the Clock app; read Arkiv directly");
  if (!perIp.take(clientIp(req))) return refuse(429, "slow down");
  const raw = await req.text();
  if (raw.length > MAX_BODY) return refuse(413, "request too large");
  let body: RpcCall | RpcCall[];
  try {
    body = JSON.parse(raw) as RpcCall | RpcCall[];
  } catch {
    return refuse(400, "bad json");
  }
  const calls = (Array.isArray(body) ? body : [body]).map((c) => ({
    jsonrpc: "2.0",
    id: (c as { id?: unknown })?.id ?? null,
    method: c?.method,
    params: (c as { params?: unknown })?.params ?? [],
  }));
  if (!calls.length || calls.length > 10 || calls.some((c) => typeof c.method !== "string" || !READS.has(c.method))) {
    return refuse(400, "read-only relay");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.ARKIV_ACCESS_KEY) headers["X-API-KEY"] = process.env.ARKIV_ACCESS_KEY;
  const upstream = await fetch(process.env.ARKIV_RPC_URL ?? "https://rpc.tiramisu.db-chain.testnet.arkiv.network", {
    method: "POST",
    headers,
    // Forward exactly what was checked: re-serialised from the parsed object, so a duplicate key or any
    // other parser difference between us and the upstream cannot smuggle a different method through.
    body: JSON.stringify(Array.isArray(body) ? calls : calls[0]),
    cache: "no-store",
  });
  return new NextResponse(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
}
