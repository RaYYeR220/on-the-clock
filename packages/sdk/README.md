# on-the-clock-sdk

Protocol SDK for [On the Clock](https://on-the-clock-arkiv.vercel.app): vulnerability-disclosure
deadlines that enforce themselves, stored on [Arkiv](https://arkiv.network) (Tiramisu testnet).

What's inside:
- the entity schema (see [`arkiv/schema.md`](https://github.com/RaYYeR220/on-the-clock/blob/main/arkiv/schema.md));
- the ERC-5564 stealth inbox (scheme 1, checked against the ScopeLift reference SDK);
- sealing (XChaCha20-Poly1305, ECIES on secp256k1) and Shamir k-of-n key splitting;
- the batched writes (file, grant, hand off, disclose, withdraw, vendor acts);
- every read, and the pure state derivation the web app and CLI share;
- the watcher that releases a case when its clock lapses.

```bash
npm i on-the-clock-sdk
```

## Read a case without anyone's backend

```ts
import { publicClient, loadCase } from "on-the-clock-sdk";

const pub = publicClient(); // public Tiramisu RPC; pass { accessKey } for a higher query budget
const bundle = await loadCase(pub, "0x…caseKey");

console.log(bundle?.view.status);   // sealed | acknowledged | fixed | lapsed | revealable | revealed | disclosed | withdrawn
console.log(bundle?.view.timeline); // every act, each judged against its on-chain $creator
```

`loadCase` runs one query for the case file and everything that points at it, then calls
`deriveCase`, a pure function. Verdicts come from `$creator` and from recomputation, never from a
field someone filled in.

## Run a watcher

```ts
import { Watcher, publicClient, liveClient, walletClient, deriveScalar } from "on-the-clock-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { hexToBytes } from "viem";

const pk = process.env.WATCHER_PRIVATE_KEY as `0x${string}`;
const w = new Watcher({
  pub: publicClient(),
  live: liveClient(),
  wallet: walletClient(privateKeyToAccount(pk)),
  encryptionKey: deriveScalar(hexToBytes(pk), "watcher-encryption"),
  operator: "me",
  region: "eu",
  version: "0.1.0",
});
await w.start();
```

Or with no code: `npx on-the-clock watch` (package [`on-the-clock`](https://www.npmjs.com/package/on-the-clock)).

Testnet only. Never use a key that holds real funds.

## License

MIT
