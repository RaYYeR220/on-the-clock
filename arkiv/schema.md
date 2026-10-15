# On the Clock: Arkiv schema

This is the data contract. Everything On the Clock writes is an Arkiv entity on **Tiramisu** (chain
`7738577`). Anyone can read it, query it, and rebuild every verdict the app shows from it, without
our backend. The SDK (`on-the-clock-sdk`) is one implementation of this contract; this file is
enough to write another.

- SDK: `@arkiv-network/sdk` **0.8.1** (pinned exactly)
- Block time: 2 s. All expiries below are block heights; durations are given in time for readability.
- Every entity carries `app = "onclock"` and `kind = <type>`, so one predicate scopes any query to
  the protocol.
- Attribute names are lowercase (the node rejects anything else). Numbers are typed `u64`; keys are
  typed `key`; addresses are typed `addr`. A bare JS number would become `i32` and silently match
  nothing against a `u64`.
- **Trust comes from `$creator`.** Attributes and payloads are claims; who wrote an entity is not.
  Every check in this document is a `$creator` check or a recomputation, never a field match.

## What is on Arkiv, and why

| Type | Written by | Typed attributes (queried) | Payload (not queried) | Entity Expiration | Flags, owner after the write |
|---|---|---|---|---|---|
| `inbox` | the vendor's wallet | `name` str, `sla` u64 (days), `embargo` u64 (days) | ERC-5564 stealth meta-address, disclosure policy | **30-day lease**, renewed by the vendor's activity; a filing extends it to deadline + 30 days | `readonly`, `permissionlessExtension`; vendor-owned |
| `case` | the researcher | `sev` u64 (1–4) | everything sealed: see below | **1 year** (a record that must outlive the case) | `readonly`, `permissionlessExtension`; owner → `0x…dEaD` in the filing batch |
| `clock` | the researcher | `case` key | `{v:1}` | **= the embargo deadline** | `readonly`; owned by the custodian (researcher, or whoever it is handed to). **Not** permissionless. |
| `trigger` | the researcher | `case` key, `target` key (the clock), `watcher` addr, `action` str | one watcher's share, ECIES-encrypted to that watcher | deadline + 7-day grace; moved together with the clock | `readonly`, `permissionlessExtension`; owner → `0x…dEaD` in the filing batch |
| `ack`, `extreq`, `fixed` | the vendor's one-time **responder** address | `case` key; `extreq`: `seconds` u64 | optional note, ECIES-encrypted to the researcher | 1 year | `readonly` |
| `grant` | the clock's custodian | `case` key, `seconds` u64 | the clock's new expiry block | 1 year | `readonly` |
| `handoff` | the clock's custodian | `case` key, `to` addr | reason | 1 year | `readonly` |
| `watcher` | a watcher's wallet | `op` str, `region` str | the watcher's encryption key | **10-minute lease**, renewed every 3 minutes while the process is alive | none |
| `receipt` | a watcher | `case` key, `target` key, `outcome` str (`lapsed` / `withdrawn` / `disclosed`), `at` u64 | the released share (for `lapsed`), what the watcher observed | 1 year | `readonly`, `permissionlessExtension` |
| `reveal` | the watcher that completes the threshold, or the researcher (early disclosure) | `case` key, `vendor` addr, `inbox` key, `by` str | the advisory key K | 1 year | `readonly`, `permissionlessExtension` |

### Why each lifetime is what it is

- **`clock` = the deadline.** This is the product. The deadline is not a field someone checks; it is
  the lifetime of an entity only its custodian can extend. A vendor's `extendEntity` on it reverts
  with `NotOwner`.
- **`trigger` = deadline + grace, extended in the same batch as the clock.** A clock pushed out
  without its escrow (shares that expire before the new deadline) cannot exist.
- **`watcher` = a 10-minute lease.** A watcher is alive exactly while its lease entity exists, so
  "which watchers are alive" is a plain query with no liveness logic anywhere.
- **`inbox` = a lease renewed by activity**, with **permissionless extension**: a researcher with an
  open case extends the vendor's inbox past the deadline in the filing batch, so a vendor cannot
  dodge attribution by letting its inbox lapse.
- **Records (`case`, acts, receipts, reveals) = 1 year.** They are the history a vendor's
  responsiveness is judged on; they must outlive the case. Published records carry
  **permissionless extension** so anyone can keep an advisory alive after we stop caring.

### What the `case` payload holds (and what an outsider can read from it)

| Field | Meaning | Readable by |
|---|---|---|
| `eph`, `vt` | ERC-5564 ephemeral key and view tag: how the vendor finds the case | everyone (random-looking) |
| `eph2` | a second ephemeral key, used only for the report | everyone (random-looking) |
| `responder` | the one-time stealth address the vendor answers from | everyone; unlinkable to the vendor until the reveal |
| `vcommit` | `keccak(inboxKey ‖ salt)`: commits to one vendor without naming it | everyone; opens only at the reveal |
| `vendorBox` | the full report, XChaCha20-Poly1305 under `HKDF(r₂·P_view)` | the vendor only, **never** auto-released |
| `selfBox` | the researcher's own copy (ECIES) | the researcher only |
| `advisoryBox` | advisory summary + reveal bundle, sealed under a random key K | anyone with K (k of n shares) |
| `reportHash`, `pocHash` | SHA-256 commitments | everyone; the PoC itself never touches Arkiv |
| `watchers`, `k` | the watcher set and threshold | everyone |
| `clock`, `deadlineBlock` | the clock's predicted key, the deadline as filed | everyone |

The explorer sees: a severity band, a random-looking blob, an address with no history, and a clock.
**It does not see the vendor, the title, the component or the report.**

## What stays off Arkiv, on purpose

- **The proof of concept.** Only its hash. A working exploit on a public database is the worst
  design error this product could make.
- **The full report.** It is on Arkiv only as ciphertext for the vendor, and its key is never
  released by the protocol, not even at the deadline.
- **The vendor's identity while the case is open.** A live entry that says "vendor X has an open
  critical, nine days left" is targeting intelligence. The vendor is a stealth address until the
  reveal.
- **Correspondence, triage, the patch.** Vendor notes are optional and encrypted to the researcher.
- **Real identities.** Researchers are wallets. Demo data is synthetic.
- **Private keys and secrets.** Watchers hold their shares in memory, re-derived from the chain on
  restart; nothing secret is ever written in plaintext.

**Expiry is not erasure.** Arkiv keeps payloads in transaction calldata, so an expired entity is gone
from queries, not from history. That is why every confidential field is encrypted rather than
"protected" by a short lifetime.

## Atomic batches

| Batch | Operations | Why atomic |
|---|---|---|
| File | create `case`, `clock`, n × `trigger` (keys pre-computed with `predictEntityKeys`) · extend the vendor's `inbox` · transfer `case` and triggers to `0x…dEaD` | a clock without escrow, or escrow without a clock, cannot exist; the case file is sealed before anyone can touch it |
| Grant | extend `clock` · extend every `trigger` · create `grant` | the escrow always outlives the deadline |
| Hand off | transfer `clock` to the coordinator · create `handoff` | the transfer is the authoritative act; the record makes it queryable (Arkiv has no ownership history) |
| Disclose early | create `reveal` (by researcher) · delete `clock` | the clock stops exactly when the key is published |
| Lapse | create `receipt` · (the k-th watcher) create `reveal` | the reveal appears in the same block as the share that made it possible |

## The queries

Every read the app makes. Run them with `on-the-clock queries <caseKey>`, or paste them into the Data
Explorer (data.arkiv.network) to see the same entities we do.

```text
# A case file and everything that points at it — one query, cursor-paged (≤200 per page)
app = "onclock" && ($key = <case> || case = <case>)

# The board: everything the protocol wrote, grouped by `case` client-side (no ORDER BY on Arkiv)
app = "onclock"

# A watcher's job list: one attribute match
app = "onclock" && kind = "trigger" && watcher = <watcherAddress>

# Alive watchers: present = alive (each is a 10-minute lease)
app = "onclock" && kind = "watcher"

# A coordinator's worklist, soonest first (sorted client-side)
app = "onclock" && kind = "clock"      ownedBy(<coordinator>)

# Clocks running out within a window ($expiresAt is a queryable block height)
app = "onclock" && kind = "clock" && $expiresAt <= <head + window>

# Reveals naming a vendor (an index; each one is re-verified before it counts)
app = "onclock" && kind = "reveal" && vendor = <vendorAddress>

# Has a watcher already answered this case?
app = "onclock" && kind = "receipt" && case = <case>      createdBy(<watcher>)

# Was the clock alive one block before its deadline? (historical query)
app = "onclock" && $key = <clock>      atBlock(<expiresAt - 1>)
```

Plus two log reads that are not entity queries:

- `eth_getLogs(EntityDeleted, entityKey = <clock>)`: a watcher's proof nobody deleted the clock.
- `eth_getLogs(EntityCreated | ExpiryExtended, entityKey = <clock>)`: the clock's real expiry once it
  is gone, so receipts are judged against what the chain did rather than what records claim.

And one live subscription: watchers call `watchEntityEvents` on a **WebSocket** transport with no
`fromBlock`, which opens a real `eth_subscribe`. They react to `ExpiryExtended` (reschedule),
`EntityDeleted` (withdrawal) and `OwnershipTransferred` (custody moved) on the clocks they hold.
`EntityCreated` carries no attributes, so new creations are coalesced into one job-list query instead
of one fetch per entity.

## How each verdict is computed

All of it is in `packages/sdk/src/state.ts`, a pure function of the entities above.

- **A vendor act counts** if `$creator == case.responder`. Before the reveal that proves "written by
  the responder"; the reveal proves the responder is the vendor.
- **A grant or handoff counts** if `$creator` is the custodian at that point in the chain of handoffs
  starting from the case's `$creator`.
- **A receipt counts** if `$creator` is one of the case's watchers and it was written at or after the
  clock's real expiry (live clock, or its logs), never before the deadline sealed in the case file.
- **A reveal counts** if its key K decrypts `advisoryBox`, opens `vcommit`, reproduces `eph` and the
  view tag from the vendor's meta-address (proof of delivery), and derives `responder` from the
  vendor's spending key. Its author is irrelevant.
- **The vendor is named** only if the inbox the bundle points to was created by that vendor and
  carries that meta-address.
