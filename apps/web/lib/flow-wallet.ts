"use client";
import { useCallback, useEffect, useState } from "react";
import { formatEther, type Address } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { burner, ensureGas, type Role } from "./burner";
import { readClient } from "./arkiv";
import { Plainly, plain } from "./flow-common";

/** This browser's wallet for a role, once mounted (localStorage does not exist on the server). */
export function useBurner(role: Role): PrivateKeyAccount | null {
  const [account, setAccount] = useState<PrivateKeyAccount | null>(null);
  useEffect(() => {
    setAccount(burner(role));
  }, [role]);
  return account;
}

export async function balanceOf(address: Address): Promise<bigint> {
  return readClient().getBalance({ address });
}

export function useBalance(address: Address | null | undefined, nonce = 0) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!address) return;
    try {
      setBalance(await balanceOf(address));
      setError(null);
    } catch (e) {
      setError(plain(e).message);
    }
  }, [address]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load, nonce]);
  return { balance, error, reload: load };
}

export const glm = (wei: bigint | null | undefined, digits = 5) => {
  if (wei == null) return "…";
  const v = Number(formatEther(wei));
  return `${v === 0 ? "0" : v < 10 ** -digits ? `<${10 ** -digits}` : v.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")} GLM`;
};

/**
 * Asks the demo faucet for gas, then checks the wallet can afford `need`. A faucet that refuses is
 * not fatal when the wallet already holds enough (someone funded it by hand).
 */
export async function topUp(address: Address, need = 0n): Promise<{ tx: string | null; balance: bigint }> {
  let tx: string | null = null;
  let faucetError: unknown = null;
  try {
    tx = await ensureGas(address);
  } catch (e) {
    faucetError = e;
  }
  const balance = await balanceOf(address);
  const floor = need > 0n ? need : 1n;
  if (balance >= floor) return { tx, balance };
  if (faucetError) {
    throw new Plainly(`${plain(faucetError).message} This wallet (${address}) holds ${glm(balance)}.`);
  }
  throw new Plainly(
    `This wallet (${address}) holds ${glm(balance)} and needs about ${glm(floor)}. The demo faucet tops each wallet up once; fund it from hub.arkiv.network/faucet, then try again.`,
  );
}
