// Shared setup for the scripts. Testnet keys come from ../.env and never leave this machine.
import { mkdirSync, writeFileSync } from "node:fs";
import { formatEther, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { hexToBytes } from "viem/utils";
import { deriveScalar, liveClient, publicClient, walletClient, type ArkivConfig } from "on-the-clock-sdk";

export const cfg: ArkivConfig = {
  ...(process.env.ARKIV_RPC_URL ? { rpcUrl: process.env.ARKIV_RPC_URL } : {}),
  ...(process.env.ARKIV_WS_URL ? { wsUrl: process.env.ARKIV_WS_URL } : {}),
  ...(process.env.ARKIV_ACCESS_KEY ? { accessKey: process.env.ARKIV_ACCESS_KEY } : {}),
};

export const pub = publicClient(cfg);
export const live = () => liveClient(cfg);

export function key(name: string): Hex {
  const v = process.env[`${name}_PRIVATE_KEY`];
  if (!v) throw new Error(`${name}_PRIVATE_KEY missing from .env`);
  return v as Hex;
}

export function account(name: string): PrivateKeyAccount {
  return privateKeyToAccount(key(name));
}

export function wallet(name: string) {
  return walletClient(account(name), cfg);
}

export function walletFor(pk: Hex) {
  return walletClient(privateKeyToAccount(pk), cfg);
}

export const watcherEncKey = (name: string) => deriveScalar(hexToBytes(key(name)), "watcher-encryption");

export const EXPLORER = "https://tiramisu.explorer.arkiv.network";
export const tx = (h: string) => `${EXPLORER}/tx/${h}`;
export const ent = (k: string) => `${EXPLORER}/entity/${k}`;

export async function balance(address: `0x${string}`) {
  return formatEther(await pub.getBalance({ address }));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function log(step: string, data: Record<string, unknown> = {}) {
  const extra = Object.entries(data)
    .map(([k, v]) => `${k}=${typeof v === "bigint" ? v.toString() : String(v)}`)
    .join(" ");
  console.log(`${new Date().toISOString().slice(11, 19)}  ${step}${extra ? `  ${extra}` : ""}`);
}

export function saveProof(name: string, data: unknown) {
  mkdirSync("../proof", { recursive: true });
  const file = `../proof/${name}.json`;
  writeFileSync(file, JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  return file;
}

/** Waits until the chain head reaches `block`, printing progress. */
export async function waitForBlock(block: bigint, label: string) {
  for (;;) {
    const head = await pub.getBlockNumber();
    if (head >= block) return head;
    const left = Number(block - head) * 2;
    if (left % 20 < 4) log(`waiting: ${label}`, { head, target: block, secondsLeft: left });
    await sleep(Math.min(4_000, left * 1000));
  }
}

/** Runs a write that is expected to fail and returns what happened, including a mined revert's hash. */
export async function expectRevert(label: string, fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    return { label, reverted: false, result: r };
  } catch (e) {
    const err = e as { message?: string; txHash?: string; cause?: unknown };
    const msg = String(err.message ?? e).split("\n")[0];
    return { label, reverted: true, error: msg, txHash: err.txHash ?? null };
  }
}
