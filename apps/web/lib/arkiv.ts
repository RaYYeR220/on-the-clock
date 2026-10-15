"use client";
// Browser-side Arkiv access. Reads go straight to the public Tiramisu RPC, so the app works with our
// backend switched off. If the anonymous query budget runs out, viem's fallback transport moves the
// session to /api/rpc, a read-only proxy that adds an access key. Writes always go direct.
import { createPublicClient, createWalletClient, type PublicArkivClient, type WalletArkivClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { createPublicClient as createViemClient, fallback, http, webSocket, type Account, type PublicClient } from "viem";

export const RPC = tiramisu.rpcUrls.default.http[0];
export const WS = tiramisu.rpcUrls.default.webSocket?.[0] ?? "wss://rpc.tiramisu.db-chain.testnet.arkiv.network";
export const EXPLORER = "https://tiramisu.explorer.arkiv.network";
export const DATA_EXPLORER = "https://data.arkiv.network";

const direct = () => http(RPC, { retryCount: 0, timeout: 15_000 });
const proxied = () => http("/api/rpc", { retryCount: 0, timeout: 20_000 });

let pub: PublicArkivClient | null = null;
let live: PublicArkivClient | null = null;

export function readClient(): PublicArkivClient {
  pub ??= createPublicClient({ chain: tiramisu, transport: fallback([direct(), proxied()], { rank: false }), pollingInterval: 1_000 });
  return pub;
}

export function liveClient(): PublicArkivClient {
  live ??= createPublicClient({ chain: tiramisu, transport: webSocket(WS, { reconnect: { attempts: 100, delay: 2_000 }, keepAlive: { interval: 20_000 } }) });
  return live;
}

let heads: PublicClient | null = null;

/** Plain viem client for the newHeads subscription that drives every countdown. */
export function headsClient(): PublicClient {
  heads ??= createViemClient({ chain: tiramisu, transport: webSocket(WS, { reconnect: { attempts: 100, delay: 2_000 }, keepAlive: { interval: 20_000 } }) }) as PublicClient;
  return heads;
}

export function writeClient(account: Account): WalletArkivClient {
  return createWalletClient({ chain: tiramisu, transport: direct(), account });
}

export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const entityUrl = (k: string) => `${EXPLORER}/entity/${k}`;
export const addressUrl = (a: string) => `${DATA_EXPLORER}/owner/${a}`;
export const queryUrl = (q: string) => `${DATA_EXPLORER}/?q=${encodeURIComponent(q)}`;
