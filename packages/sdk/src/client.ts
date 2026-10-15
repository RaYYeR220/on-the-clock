import { createPublicClient, createWalletClient, type PublicArkivClient, type WalletArkivClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, webSocket, type Account, type Transport } from "viem";

export interface ArkivConfig {
  rpcUrl?: string;
  wsUrl?: string;
  /** Optional access key from hub.arkiv.network. Sent as X-API-KEY; never put one in a browser bundle. */
  accessKey?: string;
  /** Extra headers for a proxy in front of the RPC. */
  headers?: Record<string, string>;
}

export const chain = tiramisu;

function httpTransport(cfg: ArkivConfig): Transport {
  const headers: Record<string, string> = { ...(cfg.headers ?? {}) };
  if (cfg.accessKey) headers["X-API-KEY"] = cfg.accessKey;
  // retryCount 0: viem's default retry silently waits out a long Retry-After on HTTP 429, which
  // looks like a hang. We would rather fail fast and let the caller decide.
  return http(cfg.rpcUrl ?? tiramisu.rpcUrls.default.http[0], {
    retryCount: 0,
    timeout: 20_000,
    fetchOptions: Object.keys(headers).length ? { headers } : undefined,
  });
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
