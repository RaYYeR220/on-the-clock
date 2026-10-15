// Demo faucet: tops up a browser burner wallet with a little testnet GLM so anyone can try the flow.
// Testnet only. One drip per wallet, a few per IP per hour, a global hourly cap, never while another
// drip to the same wallet is in flight, and never to a wallet that already has enough.
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, parseEther, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { Window, clientIp, sameOrigin } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRIP = parseEther("0.006");
const ENOUGH = parseEther("0.003");
const FLOOR = parseEther("0.05");

const perIp = new Window(6, 3_600_000);
const global = new Window(120, 3_600_000);
const served = new Set<string>();
const inFlight = new Set<string>();

export async function POST(req: Request) {
  const key = process.env.DRIP_PRIVATE_KEY as Hex | undefined;
  if (!key) return NextResponse.json({ error: "faucet not configured" }, { status: 503 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "use the On the Clock app" }, { status: 403 });
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: "bad address" }, { status: 400 });
  const who = address.toLowerCase();

  // Claim the wallet before any await, so concurrent requests for it cannot both pass.
  if (inFlight.has(who)) return NextResponse.json({ error: "a top-up for this wallet is already in progress" }, { status: 409 });
  inFlight.add(who);
  try {
    const rpc = http(process.env.ARKIV_RPC_URL ?? tiramisu.rpcUrls.default.http[0], { retryCount: 1 });
    const pub = createPublicClient({ chain: tiramisu, transport: rpc });
    const have = await pub.getBalance({ address });
    if (have >= ENOUGH || served.has(who)) return NextResponse.json({ skipped: true, balance: formatEther(have) });
    if (!perIp.take(clientIp(req))) return NextResponse.json({ error: "this network has asked for gas too often; try again in an hour" }, { status: 429 });
    if (!global.take("all")) return NextResponse.json({ error: "the demo faucet is busy; try again later or use hub.arkiv.network/faucet" }, { status: 429 });

    const account = privateKeyToAccount(key);
    const reserve = await pub.getBalance({ address: account.address });
    if (reserve < FLOOR) return NextResponse.json({ error: "the demo faucet is empty; use hub.arkiv.network/faucet" }, { status: 503 });

    served.add(who);
    const wallet = createWalletClient({ chain: tiramisu, transport: rpc, account });
    const tx = await wallet.sendTransaction({ to: address, value: DRIP - have });
    await pub.waitForTransactionReceipt({ hash: tx, timeout: 30_000 }).catch(() => undefined);
    return NextResponse.json({ tx, amount: formatEther(DRIP - have) });
  } finally {
    inFlight.delete(who);
  }
}
