// Demo faucet: tops up a browser burner wallet with a little testnet GLM so anyone can try the flow.
// Testnet only. Bounded per wallet, per IP and in total, and it refuses wallets that already have gas.
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, parseEther, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tiramisu } from "@arkiv-network/sdk/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRIP = parseEther("0.006");
const ENOUGH = parseEther("0.003");
const FLOOR = parseEther("0.05");
const PER_IP_PER_HOUR = 6;

const hits = new Map<string, number[]>();
const served = new Set<string>();

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  hits.set(ip, recent);
  return recent.length >= PER_IP_PER_HOUR;
}

export async function POST(req: Request) {
  const key = process.env.DRIP_PRIVATE_KEY as Hex | undefined;
  if (!key) return NextResponse.json({ error: "faucet not configured" }, { status: 503 });
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: "bad address" }, { status: 400 });

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim();
  const rpc = http(process.env.ARKIV_RPC_URL ?? tiramisu.rpcUrls.default.http[0], { retryCount: 1 });
  const pub = createPublicClient({ chain: tiramisu, transport: rpc });
  const have = await pub.getBalance({ address });
  if (have >= ENOUGH) return NextResponse.json({ skipped: true, balance: formatEther(have) });
  if (served.has(address.toLowerCase()) && have > 0n) return NextResponse.json({ skipped: true, balance: formatEther(have) });
  if (limited(ip)) return NextResponse.json({ error: "this network has asked for gas too often; try again in an hour" }, { status: 429 });

  const account = privateKeyToAccount(key);
  const reserve = await pub.getBalance({ address: account.address });
  if (reserve < FLOOR) return NextResponse.json({ error: "the demo faucet is empty; use hub.arkiv.network/faucet" }, { status: 503 });

  const wallet = createWalletClient({ chain: tiramisu, transport: rpc, account });
  const tx = await wallet.sendTransaction({ to: address, value: DRIP - have });
  hits.get(ip)!.push(Date.now());
  served.add(address.toLowerCase());
  await pub.waitForTransactionReceipt({ hash: tx, timeout: 30_000 }).catch(() => undefined);
  return NextResponse.json({ tx, amount: formatEther(DRIP - have) });
}
