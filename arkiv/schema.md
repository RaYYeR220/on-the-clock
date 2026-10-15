# On the Clock: Arkiv schema

This is the data contract. Everything On the Clock writes is an Arkiv entity on **Tiramisu** (chain
`7738577`). Anyone can read these Arkiv entities, query them, and rebuild every verdict the app shows,
without our backend. The SDK (`on-the-clock-sdk`) is one implementation of this contract; this file is
enough to write another.

- SDK: `@arkiv-network/sdk` **0.8.1** (pinned exactly).
- Block time is 2 s. Entity Expiration values are block heights; durations are given in time for
  readability.
- Every entity carries the attributes `app = "onclock"` and `kind = <type>`, so one predicate scopes
  any query to the protocol.
- Attribute names are lowercase (the node rejects anything else). Numbers are typed `u64`, entity keys
  `key`, addresses `addr`. A bare JS number would become `i32` and silently match nothing against a
  `u64`.
- **Trust comes from `$creator`.** Attributes and payloads are claims; who wrote an entity is not.
  Every check in this document is a `$creator` check or a recomputation, never a field match.

Code: entity writes are in `packages/sdk/src/actions.ts` and `packages/sdk/src/watcher.ts`, every
query is in `packages/sdk/src/read.ts`, and every verdict is in `packages/sdk/src/state.ts`.

---

## Entity types

### Entity type: `inbox`

A vendor's disclosure inbox, the equivalent of `security.txt`.

- **Written by:** the vendor's wallet (`$creator` is the vendor's identity).
- **Attributes:** `app` str · `kind` str = `inbox` · `name` str (display name) · `sla` u64 (days to acknowledge) · `embargo` u64 (default embargo, days).
- **Payload (JSON, not queried):** the vendor's ERC-5564 stealth meta-address and its disclosure policy text.
- **Entity Expiration:** a **30-day lease**, extended by the vendor's activity (Lifetime Extension). Filing a case against the inbox extends it to the case deadline + 30 days.
- **Flags:** `readonly` (keys cannot be swapped under an open case; rotation means a new inbox) and `permissionlessExtension` (anyone with an open case can keep it alive, so a vendor cannot dodge attribution by letting it lapse).
- **Owner:** the vendor.

### Entity type: `case`

The sealed case file.

- **Written by:** the researcher.
- **Attributes:** `app` str · `kind` str = `case` · `sev` u64 (severity band 1–4, so the board can range-filter).
- **Payload (JSON, not queried):** only ciphertext, commitments and public keys:
  - the ERC-5564 ephemeral key and view tag, which let the vendor find the case;
  - a second ephemeral key used only for the report;
  - the one-time responder address the vendor answers from;
  - the vendor commitment `keccak(inbox key ‖ salt)`;
  - the full report sealed for the vendor (XChaCha20-Poly1305 under `HKDF(r₂·P_view)`), never auto-released;
  - the researcher's own copy (ECIES);
  - the advisory and reveal bundle sealed under a random key K;
  - SHA-256 commitments to the report and the proof of concept;
  - the watcher set, the threshold k, the clock key and the deadline as filed.
- **Entity Expiration:** **1 year**: a case must outlive its deadline, because it is the history a vendor is judged on.
- **Flags:** `readonly` and `permissionlessExtension` (anyone can keep a published case alive).
- **Owner:** transferred to `0x000000000000000000000000000000000000dEaD` in the filing batch, so nobody can edit or delete it.

### Entity type: `clock`

The embargo itself.

- **Written by:** the researcher.
- **Attributes:** `app` str · `kind` str = `clock` · `case` key.
- **Payload:** `{ "v": 1 }`.
- **Entity Expiration:** **exactly the embargo deadline.** This is the product. The deadline is not a field anyone checks; it is the lifetime of an entity only its custodian can extend. A vendor's `extendEntity` on it reverts with `NotOwner`.
- **Flags:** `readonly`. Deliberately **not** `permissionlessExtension`.
- **Owner:** the custodian. That is the researcher, or the coordinator the clock is handed to with `changeOwnership`.

### Entity type: `trigger`

One watcher's escrowed share of the advisory key K.

- **Written by:** the researcher, in the filing batch.
- **Attributes:** `app` str · `kind` str = `trigger` · `case` key · `target` key (the clock) · `watcher` addr · `action` str (`release`).
- **Payload (JSON, not queried):** the share, ECIES-encrypted to that watcher and bound to the case, the clock and the watcher.
- **Entity Expiration:** the deadline + a **7-day grace**, extended in the same batch as the clock, so the escrow always outlives the deadline.
- **Flags:** `readonly` and `permissionlessExtension` (a coordinator holding the clock can keep the escrow alive).
- **Owner:** transferred to `0x…dEaD` in the filing batch.

### Entity type: `ack`, `extreq`, `fixed`

The vendor's acts on a case.

- **Written by:** the case's one-time **responder** address (a stealth address only the vendor controls).
- **Attributes:** `app` str · `kind` str · `case` key · and on `extreq` only, `seconds` u64 (the time asked for).
- **Payload (JSON, not queried):** an optional note, ECIES-encrypted to the researcher.
- **Entity Expiration:** **1 year**.
- **Flags:** `readonly`.

### Entity type: `grant`

An extension, granted by the clock's custodian.

- **Written by:** the clock's custodian.
- **Attributes:** `app` str · `kind` str = `grant` · `case` key · `seconds` u64.
- **Payload (JSON, not queried):** the clock's new expiry block, and the request it answers.
- **Entity Expiration:** **1 year**.
- **Flags:** `readonly`.

### Entity type: `handoff`

The queryable record of a custody transfer. Arkiv exposes the current `$owner`, not ownership history.

- **Written by:** the clock's custodian, in the same batch as `changeOwnership`.
- **Attributes:** `app` str · `kind` str = `handoff` · `case` key · `to` addr.
- **Payload (JSON, not queried):** the reason.
- **Entity Expiration:** **1 year**.
- **Flags:** `readonly`.

### Entity type: `watcher`

A watcher's liveness lease.

- **Written by:** the watcher's wallet.
- **Attributes:** `app` str · `kind` str = `watcher` · `op` str (operator) · `region` str.
- **Payload (JSON, not queried):** the watcher's encryption public key and version.
- **Entity Expiration:** a **10-minute lease**, renewed every 3 minutes while the process runs (Lifetime Extension as a lease renewed by activity). "Which watchers are alive" is a plain query: present means alive.

### Entity type: `receipt`

A watcher's signed observation.

- **Written by:** a watcher.
- **Attributes:** `app` str · `kind` str = `receipt` · `case` key · `target` key · `outcome` str (`lapsed`, `withdrawn` or `disclosed`) · `at` u64 (the head block it observed).
- **Payload (JSON, not queried):** the released share (for `lapsed` only), plus what the watcher observed (deadline, last block the clock was alive).
- **Entity Expiration:** **1 year**.
- **Flags:** `readonly` and `permissionlessExtension`.

### Entity type: `reveal`

The published advisory key K.

- **Written by:** the watcher whose receipt completes the threshold, or the researcher for an early disclosure. Its author does not matter: a reveal is trusted by recomputation.
- **Attributes:** `app` str · `kind` str = `reveal` · `case` key · `vendor` addr · `inbox` key · `by` str (`watchers` or `researcher`).
- **Payload (JSON, not queried):** K.
- **Entity Expiration:** **1 year**.
- **Flags:** `readonly` and `permissionlessExtension`: an advisory should outlive anyone's interest in burying it.

---

## What stays off Arkiv, on purpose

- **The proof of concept.** Only its hash goes on chain. A working exploit on a public database is the
  worst design error this product could make.
- **The full report in readable form.** It is on Arkiv only as ciphertext for the vendor, and its key
  is never released by the protocol, not even at the deadline.
- **The vendor's identity while the case is open.** A live entity that says "vendor X has an open
  critical, nine days left" is targeting intelligence. The vendor is a stealth address until the
  reveal.
- **Correspondence, triage, the patch.** Vendor notes are optional and encrypted to the researcher.
- **Real identities.** Researchers are wallets, and all demo data is synthetic.
- **Private keys and secrets.** Watchers keep their shares in memory and re-derive them from the chain
  on restart. Nothing secret is ever written in plaintext.

**Expiry is not erasure.** Arkiv keeps payloads in transaction calldata: an expired entity disappears
from queries, not from history. That is why every confidential field is encrypted rather than
"protected" by a short lifetime.

## Atomic batches (`executeBatch`)

- **File:** create `case`, `clock` and n × `trigger` (keys pre-computed with `predictEntityKeys`), extend the vendor's `inbox`, and transfer `case` and the triggers to `0x…dEaD`.
  - A clock without escrow, or escrow without a clock, cannot exist.
  - The case file is sealed before anyone can touch it.
- **Grant:** extend `clock`, extend every `trigger`, and create `grant`. The escrow always outlives the deadline.
- **Hand off:** transfer `clock` to the coordinator and create `handoff`. The transfer is the authoritative act; the entity makes it queryable.
- **Disclose early:** create `reveal` (by the researcher) and delete `clock`. The clock stops exactly when K is published.
- **Lapse:** create `receipt`, and the k-th watcher also creates `reveal`. The reveal lands in the same block as the share that made it possible.

---

## Queries the app runs

These are the actual calls, taken from `packages/sdk/src/read.ts` and `packages/sdk/src/watcher.ts`.
`on-the-clock queries <caseKey>` prints the rendered query strings, and the same strings work in the
Data Explorer (data.arkiv.network).

```ts
import { eq, or, lte } from "@arkiv-network/sdk/query";
import { str, key, addr, u64 } from "@arkiv-network/sdk/attr";

// 1. A case and every Arkiv entity that points at it: one compound query, cursor-paged (≤200/page).
const page = await client
  .select("*")
  .where(eq("app", str("onclock")), or(eq("$key", key(caseKey)), eq("case", key(caseKey))))
  .limit(200)
  .fetch();
// then page.hasNextPage() / page.next() until done

// 2. The board: everything the protocol wrote, grouped by `case` client-side (Arkiv has no ORDER BY).
await client.select("*").where(eq("app", str("onclock"))).limit(200).fetch();

// 3. A watcher's job list: one attribute match on a typed address.
await client
  .select("*")
  .where(eq("app", str("onclock")), eq("kind", str("trigger")), eq("watcher", addr(watcherAddress)))
  .limit(200)
  .fetch();

// 4. Alive watchers: each is a 10-minute lease, so present = alive.
await client.select("*").where(eq("app", str("onclock")), eq("kind", str("watcher"))).limit(200).fetch();

// 5. A coordinator's worklist: the clocks it owns ($owner), sorted by expiry client-side.
await client.select("*").where(eq("app", str("onclock")), eq("kind", str("clock"))).ownedBy(coordinator).limit(200).fetch();

// 6. Clocks running out within a window: $expiresAt is a queryable u64 block height.
await client
  .select("*")
  .where(eq("app", str("onclock")), eq("kind", str("clock")), lte("$expiresAt", u64(head + windowBlocks)))
  .limit(200)
  .fetch();

// 7. Reveals naming a vendor: an index only; each one is re-verified before it counts.
await client
  .select("*")
  .where(eq("app", str("onclock")), eq("kind", str("reveal")), eq("vendor", addr(vendorAddress)))
  .limit(200)
  .fetch();

// 8. Has this watcher already answered this case? Filtered by the immutable $creator.
await client
  .select("*")
  .where(eq("app", str("onclock")), eq("kind", str("receipt")), eq("case", key(caseKey)))
  .createdBy(watcherAddress)
  .limit(200)
  .fetch();

// 9. Was the clock alive one block before its deadline? A historical query.
await client
  .select("*")
  .where(eq("app", str("onclock")), eq("$key", key(clockKey)))
  .atBlock(expiresAt - 1n)
  .limit(200)
  .fetch();
```

Rendered, query 1 is:

```text
app = str('onclock') AND ($key = key(0x…case) OR case = key(0x…case))
```

### Log reads (not entity queries)

- `eth_getLogs` for `EntityDeleted(entityKey = clock)`: a watcher's proof that nobody deleted the clock.
- `eth_getLogs` for `EntityCreated` and `ExpiryExtended(entityKey = clock)`: the clock's real expiry once it is gone. Receipts are judged against what the chain did, not what any entity claims.

### Live subscription

Watchers and the web app call `watchEntityEvents` over a **WebSocket** transport with no `fromBlock`,
which opens a real `eth_subscribe`:

- `ExpiryExtended` reschedules a watcher's job.
- `EntityDeleted` means the case was withdrawn or disclosed early.
- `OwnershipTransferred` means custody moved.
- `EntityCreated` carries no attributes, so watchers coalesce creations into one job-list query.
  The web app refreshes only on creations by a case's known authors (the event's indexed `owner`).

---

## How each verdict is computed

`packages/sdk/src/state.ts` holds a pure function over the Arkiv entities above:

- **A vendor act counts** if its `$creator` is the case's responder. Before the reveal that only proves "written by the responder"; the reveal then proves the responder is the vendor.
- **A grant or handoff counts** if its `$creator` was the custodian at that point in the chain of handoffs that starts from the case's `$creator`.
- **A receipt counts** if its `$creator` is one of the case's watchers and it was written at or after the clock's real expiry. The real expiry is read from the live clock or, once it is gone, from the clock's logs. A receipt never counts before the deadline sealed in the case.
- **A reveal counts** if K:
  - decrypts the advisory;
  - opens the vendor commitment;
  - reproduces the published ephemeral key and view tag from the vendor's meta-address (proof of delivery);
  - derives the responder from the vendor's spending key.
- **The vendor is named** only if the inbox the reveal points to was created by that vendor and carries that meta-address.
