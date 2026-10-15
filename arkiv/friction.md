# Friction report: building On the Clock on Arkiv

Everything below was hit while building this project, between 9 and 18 October 2026. Each entry
gives the surface, versions, exact steps, what we expected, what happened, and what would fix it.
Smooth paths we tested with the same rigour are listed at the end; they count as much as the rough
ones.

**Environment for every entry unless noted:** `@arkiv-network/sdk` 0.8.1 (pinned), viem 2.57.4,
Node 24.13.0, Windows 11 (10.0.26300) and Linux containers (node:24-alpine), Tiramisu (chain
7738577), public RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`. "Simulated" means
we ran the engine through `eth_call`/`eth_estimateGas` (a real node-side result) rather than a
broadcast transaction.

Fields mirror the `reported-issues` bug form: surface · version · steps · expected · actual · fix.

## Contents

1. [What shaped our architecture](#1-what-shaped-our-architecture) — four properties of Arkiv that changed the design, and how we built around them
2. [SDK](#2-sdk)
3. [RPC and gateway](#3-rpc-and-gateway)
4. [Events](#4-events)
5. [Docs and discovery](#5-docs-and-discovery)
6. [Arkiv MCP (`mcp.arkiv.network/devfolio`)](#6-arkiv-mcp)
7. [Smooth paths we tested](#7-smooth-paths-we-tested)
8. [The one thing to fix first](#8-the-one-thing-to-fix-first)

---

## 1. What shaped our architecture

These are not bugs. They are properties a builder only discovers by building, and each one cost us a
design decision. They are listed first because they are the most useful thing in this file.

### 1.1 There is no event when an entity's lifetime runs out

**Surface:** chain / `watchEntityEvents`. **Version:** SDK 0.8.1.

**What we needed:** our product *is* an expiry. When an embargo clock's Entity Expiration arrives,
something has to happen (key shares are released).

**What Arkiv gives:** an expired entity simply stops appearing in queries and `getEntity` throws
`NoEntityFoundError`. `ENTITY_EVENTS_ABI` has `EntityCreated`, `EntityPatched`, `ExpiryExtended`,
`OwnershipTransferred`, `EntityDeleted`, and nothing for natural expiry.

**What we built around it:** a watcher network (Hub open challenge #2, "Arkiv Triggers"). Each
watcher:

1. learns the clock's `expiresAt` from the entity;
2. follows `ExpiryExtended` and `EntityDeleted` over a WebSocket subscription;
3. at the expiry block, proves the lapse three ways:
   - `getEntity` throws;
   - a historical query at `atBlock(expiresAt - 1)` still finds the clock;
   - `eth_getLogs` shows no `EntityDeleted` for its key;
4. then writes a signed receipt.

**Fix that would help everyone:** an `EntityExpired` log emitted by the block that drops an entity
(or a per-block list of expired keys over RPC). Every expiry-driven app (canaries, leases, heartbeats)
has to re-poll or run a watcher to notice a death; with a log, it is one subscription.

### 1.2 Entity events carry no attributes

**Surface:** `watchEntityEvents`. **Steps:** subscribe with `onEntityCreated`; log the event.
**Actual:** `{ type, entityKey, owner, expiresAt, creationFlags, blockNumber, transactionHash, logIndex }`.
There is no `kind` and no app attribute.

**Consequence:** a client cannot tell whether a new entity is relevant without fetching it, and every
fetch is an `arkiv_query` (100 cost units). On a busy testnet that is a query storm.

**What we did:**
- Our watchers coalesce creations into one job-list query every few seconds.
- The web app refreshes only on creations whose indexed `owner` is a known author of the case.

**Fix:** let a subscription filter by attribute (`app = "x"`), or include the attribute map in
`EntityCreated`.

### 1.3 Arkiv knows the current `$owner`, not ownership history

**Surface:** queries / data model. **Steps:** `changeOwnership(clock, coordinator)`, then try to ask
"who held this clock at block N". `atBlock` covers about 11 days, but there is no history query.

**What we did:** every handoff is the transfer **plus** a `handoff` record in the same atomic batch.
The transfer is authoritative; the record makes it queryable. This is a pattern every custody-style
app will rediscover. A sentence next to `changeOwnership` in the docs would save the next team an
afternoon.

### 1.4 Expiry is not erasure, and confidentiality has to be designed in

**Surface:** docs / mental model. The skill references say it correctly ("the SDK puts payload and
attributes into transaction calldata"), but the Fundamentals page reads as if a short lifetime
protects data.

**What we did:**
- Every confidential field is encrypted.
- An embargoed report is never "protected" by a short lifetime.
- The full report is keyed separately from anything that is ever released.

**Fix:** a "short lifetimes do not hide data" callout on Fundamentals, linking to the encryption skill.

---

## 2. SDK

### F-01 · `EntityMutationError` hides the real cause ("Execution error without revert data")

**Steps:**

```js
const w = createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(<fresh key, 0 GLM>) })
await w.createEntity({ payload: jsonToPayload({ a: 1 }), contentType: "application/json",
  attributes: { project: str("x") }, expires: ExpirationTime.fromHours(1) })
```

**Expected:** a message that says the account has no GLM.
**Actual:** `EntityMutationError: Transaction failed: Execution error without revert data`. The cause
chain holds `details: "out of gas: gas required exceeds: 0"` (RPC -32003).
The same opaque message appears for:
- (a) a 130,500-byte payload, whose real cause is HTTP 413 (see F-02);
- (b) a JSON-RPC (address-only) account, whose real cause is `eth_sendTransaction does not exist`.

**Fix:**
- In the `ContractFunctionExecutionError` branch of `sendArkivTransaction`, append `error.details` / `cause.shortMessage`.
- Map -32003 with "gas required exceeds: 0" to "account has no GLM — use the faucet".

### F-03 · Uppercase attribute names pass the SDK and fail on the node, with a self-contradicting message

**Steps:** `createEntity({ … attributes: { project: str("x"), createdAt: u64(1n) } … })`.
**Expected:** rejected client-side, or accepted.

**Actual:**
- The SDK's name regex `/^[A-Za-z][A-Za-z0-9._-]*$/` lets it through.
- The node reverts with `Ident32InvalidByte(7, 0x41)`.
- The SDK message says the name is "outside the name charset ("A"-"Z", "a"-"z", …)". The charset it quotes includes the very letter it rejects.
- `eq("camelCase", …)` builds fine and silently matches nothing.

**Fix:**
- Change the regex to `^[a-z][a-z0-9._-]*$`.
- Fix the charset string in `utils/revert.ts`.
- Fix the JSDoc examples (`testKey`, `projectId`) and the Best Practices page (`priceCents`).

### F-05 · The builder refuses `$createdAt` / `$contentType` filters the node supports

**Steps:** `pub.select({ key: true }).where(gt("$createdAt", u64(1n))).fetch()`.
**Expected:** a filtered query; the JSON-RPC page lists `$createdAt` as filterable.
**Actual:** `InvalidPredicateError: "$createdAt" is returned in query results but carries no index…`,
thrown client-side. Raw `pub.query("$createdAt > u64(1)")` returns rows. Same for `$contentType`
(sdk-js #100).
**Fix:** add `$createdAt: "u64"` and `$contentType: "str"` to `QUERYABLE_SYSTEM_ATTRIBUTES`; align the
TS docs.

### F-06 · The builder cannot express "match all", and its error says the opposite of the node

**Steps:** `pub.select({ key: true }).fetch()`.
**Actual:** `InvalidPredicateError: A query needs at least one filter — the language has no spelling
for 'match every entity". …`.
- The node supports `*`, and `pub.query("*")` works.
- The message's quotes are mismatched.
- `and([])` advises "omit the filter entirely to match everything", which the builder then refuses.

**Fix:** let the builder send `*`, or reword both messages.

### F-07 · Extension-equality semantics disagree across docs and JSDoc

**Steps:** from the owner, `extendEntity` to exactly the current `expiresAt` (simulated).
**Actual:** an equal target succeeds (25,581 gas); an earlier one reverts `ExpiryNotExtended(key, new,
current)`. The TS docs say "an equal one is a no-op", the JSON-RPC page says it "reverts", and JSDoc
says the engine "rejects an extension that would not move the expiry later".
**Fix:** one rule, stated once.

Also worth stating loudly: `extendEntity` **sets** an absolute expiry, it does not add time. In our
spike, `extendEntity(…, ExpirationTime.fromMinutes(1))` on an entity with about 30 minutes left reverted
`ExpiryNotExtended` (simulated). "Grant one more minute" written the natural way therefore fails. Our
grants compute `currentExpiry + blocks(seconds)` and pass `atBlock(…)`. An `ExpirationTime.extendBy()`
helper would remove the footgun.

### F-08 · `QueryError` drops the node's helpful text

**Steps:** `.where(ne("project", str("x")))`.
**Actual:** `Query rejected (type, -32002): Requested resource not available..`. That is viem's
generic text. `error.data.message` holds the useful line: `"!= is not part of the query language —
write NOT (attr = value) for the complement"`.
**Fix:**
- Surface `data.message`.
- Mark `ne` / `exists` / `hasType` as `@deprecated`, since they are exported but rejected by the node.

### F-11 · `getEntityCount()` takes no filter, though the node supports one

**Steps:** raw `arkiv_getEntityCount [{"query":"project = str('…')"}]` returns 847.
`pub.getEntityCount()` returns the chain-wide 6954; its RPC schema declares `Parameters?: []`.
**Fix:** `getEntityCount(query?, { atBlock })` (sdk-js #110). We wanted it for the board's summary
strip.

### F-15 · `PublicArkivClient` drops viem's own public actions

**Surface:** SDK types.
**Steps:** `createPublicClient({ chain: tiramisu, transport: webSocket() }).watchBlockNumber(…)` from
`@arkiv-network/sdk`.
**Expected:** viem's public actions plus Arkiv's; we wanted `newHeads` for countdowns.
**Actual:** `TS2551: Property 'watchBlockNumber' does not exist on type …`. `getLogs` works, but
`watchBlockNumber` is missing from the type.
**What we did:** we created a second, plain viem client just for block heads.
**Fix:** extend `publicActions` fully, or document which viem actions are kept.

### F-16 · Unused 3.2 MB runtime dependency

`dependencies: { "brotli-wasm": "^3.0.1" }`. `src/utils/compression.ts` is imported nowhere, and no
`dist` file references brotli. It inflates every install and every bundle analysis.
**Fix:** drop it.

---

## 3. RPC and gateway

### F-02 · The documented 128 KiB payload is unreachable through the public RPC

**Steps:** binary search with `eth_estimateGas` for a create with an N-byte payload.
**Expected:** N = 131,072 works (docs, `MAX_PAYLOAD_BYTES`).

**Actual:**
- N ≤ 130,208 works.
- N = 130,209 gives HTTP **413** `{"error":"BAD_REQUEST","message":"request body too large"}` (body 262,202 B).
- The gateway caps JSON bodies at 256 KiB, and hex encoding doubles the calldata.
- Through the SDK this surfaces as F-01's opaque message.

**Fix:** raise the gateway body limit, or set `MAX_PAYLOAD_BYTES` to the effective maximum with a clear
error.

### F-04 · The docs say lifetime drives cost; measured gas is identical for 1 hour and permanent

**Steps:** `eth_estimateGas` of an identical create with lifetimes of 1 h, 1 d, 30 d and 1 y, and with
`permanent()`.
**Expected:** gas grows with lifetime ("Start with a short lifetime to save on fees").
**Actual:** 86,306 gas for every one. Only payload size moves cost (about 40 gas per byte). We
chose our lifetimes for product meaning, not cost, and that turned out to be the right call.
**Fix:** price lifetime as documented, or say that the testnet schedule is size-only for now.

### F-10 · The default transport silently waits out `Retry-After` on HTTP 429

**Steps:** a local mock RPC returning `429` with `retry-after: 20`, then any query through the default
`http()` transport.

**Actual:**
- After 8 s the query is still pending and only one request has been sent: viem waits out `Retry-After`.
- With the reported ~45-minute anonymous-budget `Retry-After`, a page simply hangs.
- `http(url, { retryCount: 0 })` rejects in 3 ms.

**What we did:**
- `retryCount: 0` everywhere.
- Browser reads go to the public RPC first and fall back to a same-origin, read-only relay carrying an access key (viem `fallback`).

**Fix:**
- Cap the retry delay in the SDK's transport defaults.
- Document the anonymous cost budget, and that `arkiv_query` costs 100 units (the `arkiv-cost` header).

### F-12 · Fundamentals claims non-Arkiv transactions revert; plain transfers succeed

Tx `0x1ed4810f8409d3a0b98ad5eded67741d01e9b9a27a9a04e8a10df92621222323` (block 602057) is an EOA→EOA
transfer of 0.1 GLM with status 1. We rely on this: a researcher pays the vendor's one-time
responder address its gas, so the vendor never funds it from an identifiable wallet.
**Fix:** reword to "no contract execution; value transfers are allowed".

### F-13 · `eth_call` to `execute` returns `0x`, not the documented `bytes32[] keys`

A valid create through `eth_call` returns `"0x"`. The docs give `returns (bytes32[] keys)`, so you must
use `predictEntityKeys` (which works well; see §7).

---

## 4. Events

### F-09 · HTTP `watchEntityEvents` polls every 4 s, not "half a block"

**Steps:** 20 s with the default `http()` client, counting RPC calls.

**Actual:**
- In 20 s it made 5× `eth_blockNumber` and 4× `eth_getLogs`, after 1 failed `eth_newFilter` (unavailable on the RPC).
- `client.pollingInterval` is 4000, because `tiramisu` has no `blockTime`.
- Event latency: p50 2.1 s, p90 3.7 s.
- A WebSocket transport without `fromBlock` uses `eth_subscribe` at **p50 39 ms**. The Live Events page never mentions this.

**Fix:**
- Add `blockTime: 2_000` and `blockExplorers` to the `tiramisu` chain.
- Document that `webSocket()` without `fromBlock` subscribes, and that `fromBlock` forces polling.

---

## 5. Docs and discovery

### F-14 · Discovery files point agents and developers to dead or odd places

- `https://arkiv.network/llms.txt` lists the MCP server as `https://hub.arkiv.network/mcp`. That page
  says "MCP SETUP IS TEMPORARILY UNAVAILABLE"; the working endpoint is `https://mcp.arkiv.network/devfolio`.
- `docs.arkiv.network/llms.txt` contains a literal `### Symbol(StarlightTypeDocSidebarGroupLabel)`.
- `.md` page exports carry raw MDX (`<NetworkNote />`) and broken tab fences.
- `/llms-full.txt` and `/quickstart` return 404.

**Fix:** point `llms.txt` at the working MCP, and render components in the `.md` export.

### F-17 · The `reported-issues` bug form has no Tiramisu option

Its "DB-chain" dropdown offers Kaolin / Braga / Local / Other. Tiramisu is the only live network.

---

## 6. Arkiv MCP

We used `mcp.arkiv.network/devfolio` (streamable HTTP, keyless) to pre-check our schema. It found
real gaps, and we fixed them. These entries are about the checker itself.

### M-01 · `check_schema` gives no hint of the heading format it recognises

**Steps:**
1. Send a schema with one `### Entity type: \`inbox\`` heading per type and a bullet list of attributes.
2. Send the same schema again with each type as `` ### `inbox` ``, an `| Attribute | Type | Purpose |` table, and an `Entity Expiration: …` line.

**Actual:**
- **Run 1:** `blockers_found`. "must describe attributes for every entity type. Unrecognized for type #1 at line 26…". `observed.entityTypeHeadings: 0`, yet `typeLocations` lists the lines it found.
- **Run 2:** `no_blockers_found`, `entityTypeHeadings: 12`.

**Fix:** state the accepted shapes in the blocker message, or link an example `schema.md`.

### M-02 · `check_schema` rejects lifetimes that are set per entity

**Steps:** describe a type whose lifetime is product-defined: "Entity Expiration: the embargo
deadline", and "the deadline + 7 days of grace".
**Actual:** blocker: "must describe Entity Expiration for every entity type", for exactly those two
types. It is satisfied once a duration is written ("90 days by default").
**Why it matters:** per-entity lifetimes are the strongest use of Entity Expiration (the rubric asks
for "lifetimes that follow product logic"), and the checker penalises them.
**Fix:** accept "set per entity" / "chosen per case" as a description.

### M-03 · `check_schema` flags payload JSON keys as uppercase attribute names

**Steps:** list the payload's JSON fields in a table (`| \`vendorBox\` | … |`) under a heading that
says "Payload (not queried)".
**Actual:** warning: "An attribute name contains uppercase…", matching `vendorBox` and `selfBox`. Payload
keys are not attributes, and camelCase is valid there.
**Fix:** scope the check to attribute tables.

### M-04 · Smooth: `check_schema` caught a real omission

On our first draft it reported "No concrete application query was recognized". It was right: we had
written pseudo-queries instead of the SDK calls the app makes. The schema now lists the actual
`select().where(…)` calls from `packages/sdk/src/read.ts`, and the checker counts them
(`queryBuilderCalls: 9`, `multiFilterQueries: 2`).

---

## 7. Smooth paths we tested

Each of these was tested, and the result matched what we expected.

**Chain and clients**
- The `tiramisu` export from `@arkiv-network/sdk/chains` works out of the box: `getChainId()` = 7738577.
- Plain GLM transfers between EOAs work (F-12), so researchers can pay a vendor's one-time responder its gas.

**Batches and keys**
- **`predictEntityKeys` + salts:** we pre-compute 5 keys (case, clock, 3 triggers) and reference them from each other's attributes and encrypted payloads inside one `executeBatch`. The keys matched every time.
- **Batch atomicity:** a batch whose later operation fails applies nothing (`[extend later, extend earlier]` reverts entirely).
- Creates, extensions and ownership transfers in one batch run in a documented order (creates → patches → deletes → extensions → transfers). That is what lets us create a case and seal it to `0x…dEaD` in the same transaction.

**Ownership and flags**
- **Ownership and flags behave as documented:**
  - owner-only writes, with clear revert messages ("entity 0x… is owned by 0x…, not 0x…");
  - `TransferToSelf` and `TransferToZeroAddress` reverts;
  - `readonly` blocks patches only;
  - `permissionlessExtension` lets any wallet extend.
- `createdBy()` survives `changeOwnership`, so trust anchored on `$creator` keeps working after a case is sealed or handed off.

**Queries**
- Compound `and`/`or`/`not`, numeric ranges, `$expiresAt` ranges, `$key`, `createdBy()`, `ownedBy()` and cursor pagination all work.
- Cursors are bound to query + select + block, with an excellent error: "cursor belongs to a different query, block or select — start a new page-through".
- **Historical queries:** `atBlock(head - 500000)` works, and is what our watchers use to prove a clock was alive one block before its deadline.

**Errors**
- Clear validation errors:
  - `ExpirationTime.fromSeconds(7)` → "must be a multiple of the 2s block time… Try 6 or 8";
  - `i32(Date.now())` → "use u64(...)";
  - a bad content type → `InvalidContentTypeError`.

**Events**
- **WebSocket events without `fromBlock`:** a real subscription at p50 39 ms. Our watchers and the web app's countdowns depend on it.

**Tooling**
- The Data Explorer serves Tiramisu with deep links (`/owner/0x…`, query strings) that we link from every case page.
- The MCP is keyless and fast; `check_schema` is a useful gate (M-04).

## 8. The one thing to fix first

**An `EntityExpired` log (§1.1).** Arkiv's most distinctive primitive is that data ends on schedule,
and today nothing tells you it did. Every expiry-driven app in this challenge (canaries, leases,
heartbeats, ours) builds its own polling or watcher layer to notice. One log line in the block that
drops an entity would turn all of that into a subscription.
