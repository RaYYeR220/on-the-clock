// Read-only RPC relay with an access key. The app only falls back to it when the anonymous query
// budget is exhausted; everything it serves is public, and nothing that writes is forwarded.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "arkiv_query",
  "arkiv_getEntity",
  "arkiv_getEntityCount",
  "arkiv_getBlockTiming",
]);

type RpcCall = { method?: string };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RpcCall | RpcCall[] | null;
  const calls = Array.isArray(body) ? body : body ? [body] : [];
  if (!calls.length || calls.length > 20 || calls.some((c) => !c.method || !READS.has(c.method))) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "read-only relay" } }, { status: 400 });
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.ARKIV_ACCESS_KEY) headers["X-API-KEY"] = process.env.ARKIV_ACCESS_KEY;
  const upstream = await fetch(process.env.ARKIV_RPC_URL ?? "https://rpc.tiramisu.db-chain.testnet.arkiv.network", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return new NextResponse(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
}
