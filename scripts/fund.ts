// Distributes testnet GLM from the treasury to every project wallet that is running low.
import { parseEther } from "viem";
import { account, balance, log, pub, wallet } from "./lib.ts";

const TARGETS: Record<string, string> = {
  WATCHER_1: "0.03",
  WATCHER_2: "0.03",
  WATCHER_3: "0.03",
  DRIP: "0.2",
  SEED_RESEARCHER_1: "0.03",
  SEED_RESEARCHER_2: "0.03",
  SEED_VENDOR_1: "0.01",
  SEED_VENDOR_2: "0.01",
  SEED_VENDOR_3: "0.01",
  SEED_COORDINATOR: "0.01",
  SEED_IMPOSTOR: "0.01",
};

const treasury = wallet("TREASURY");
log("treasury", { address: account("TREASURY").address, balance: await balance(account("TREASURY").address) });

for (const [name, amount] of Object.entries(TARGETS)) {
  const a = account(name).address;
  const have = await pub.getBalance({ address: a });
  const want = parseEther(amount);
  if (have >= want / 2n) {
    log(`skip ${name}`, { balance: await balance(a) });
    continue;
  }
  const hash = await treasury.sendTransaction({ to: a, value: want - have, account: treasury.account!, chain: treasury.chain });
  await pub.waitForTransactionReceipt({ hash });
  log(`funded ${name}`, { address: a, tx: hash, balance: await balance(a) });
}
log("treasury left", { balance: await balance(account("TREASURY").address) });
