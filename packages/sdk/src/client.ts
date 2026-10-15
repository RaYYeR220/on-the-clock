import { createPublicClient, createWalletClient, type PublicArkivClient, type WalletArkivClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { fallback, http, webSocket, type Account, type Transport } from "viem";

export interface ArkivConfig {
  rpcUrl?: string;
  wsUrl?: string;
  /** Optional access key from hub.arkiv.network. Sent as X-API-KEY; never put one in a browser bundle. */
  accessKey?: string;
  /** Extra headers for a proxy in front of the RPC. */
  headers?: Record<string, string>;
}

export const chain = tiramisu;

/** True when an error, or anything in its cause chain, is an HTTP 429 or an RPC quota refusal. */
export function isRateLimited(e: unknown): boolean {
  for (let c: unknown = e, i = 0; c && i < 8; c = (c as { cause?: unknown }).cause, i++) {
    if ((c as { status?: number }).status === 429) return true;
    const m = String((c as { message?: unknown }).message ?? "");
    if (/\b429\b|QUOTA_EXCEEDED|ANON_COST_LIMITED/.test(m)) return true;
  }
  return false;
}

const KEY_COOL_MS = 10 * 60_000;

/** Wraps a transport so that after an HTTP 429 it steps aside for a while and a fallback behind it takes the load. */
function stepsAsideOn429(inner: Transport, coolMs: number): Transport {
  let until = 0;
  return (opts) => {
    const t = inner(opts);
    const request = (async (args: Parameters<typeof t.request>[0]) => {
      if (Date.now() < until) throw new Error("access key quota spent for now; using the public RPC");
      try {
        return await t.request(args);
      } catch (e) {
        if (isRateLimited(e)) until = Date.now() + coolMs;
        throw e;
      }
    }) as typeof t.request;
    return { ...t, request };
  };
}

function httpTransport(cfg: ArkivConfig): Transport {
  const url = cfg.rpcUrl ?? tiramisu.rpcUrls.default.http[0];
  const plain = (headers: Record<string, string>) =>
    // retryCount 0: viem's default retry silently waits out a long Retry-After on HTTP 429, which
    // looks like a hang. We would rather fail fast and let the caller decide.
    http(url, { retryCount: 0, timeout: 20_000, fetchOptions: Object.keys(headers).length ? { headers } : undefined });
  const base = { ...(cfg.headers ?? {}) };
  if (!cfg.accessKey) return plain(base);
  // A key's quota can run out. When it does, carry on under the anonymous budget instead of stopping.
  return fallback([stepsAsideOn429(plain({ ...base, "X-API-KEY": cfg.accessKey }), KEY_COOL_MS), plain(base)], { rank: false, retryCount: 0 });
}

export function publicClient(cfg: ArkivConfig = {}): PublicArkivClient {
  // pollingInterval: the chain definition has no blockTime, so viem would otherwise poll every 4 s.
  return createPublicClient({ chain: tiramisu, transport: httpTransport(cfg), pollingInterval: 1_000 });
}

/** WebSocket client: `watchEntityEvents` without `fromBlock` opens a real eth_subscribe on it. */
export function liveClient(cfg: ArkivConfig = {}): PublicArkivClient {
  return createPublicClient({
    chain: tiramisu,
    transport: webSocket(cfg.wsUrl ?? tiramisu.rpcUrls.default.webSocket?.[0], { reconnect: { attempts: 1_000, delay: 2_000 }, keepAlive: { interval: 20_000 } }),
  });
}

export function walletClient(account: Account, cfg: ArkivConfig = {}, transport?: Transport): WalletArkivClient {
  return createWalletClient({ chain: tiramisu, transport: transport ?? httpTransport(cfg), account });
}

export type { PublicArkivClient, WalletArkivClient };
