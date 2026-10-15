#!/usr/bin/env node
// on-the-clock: read and verify disclosure clocks straight from Arkiv, or run a watcher.
// No backend: every command talks to the Tiramisu RPC directly.
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { hexToBytes, type Hex } from "viem";
import {
  BLOCK_SECONDS,
  SEVERITY,
  Watcher,
  deriveScalar,
  liveClient,
  currentInboxes,
  listInboxes,
  loadBoard,
  loadCase,
  publicClient,
  resolveReveal,
  walletClient,
  type ArkivConfig,
  type CaseView,
  type Severity,
} from "on-the-clock-sdk";

const VERSION = "0.1.0";
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number) => (s: string | number) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c(2), bold = c(1), red = c(31), green = c(32), yellow = c(33), cyan = c(36);

const HELP = `on-the-clock ${VERSION}: self-enforcing disclosure deadlines on Arkiv

Usage
  on-the-clock verify <caseKey> [--json]   Rebuild a case from Arkiv and check every act on it
  on-the-clock board [--json]              Every case, its status and time left
  on-the-clock inboxes [--json]            Vendor inboxes accepting reports
  on-the-clock queries <caseKey>           Print the exact Arkiv queries verify runs
  on-the-clock watch                       Run a watcher (see env below)

Environment
  ARKIV_RPC_URL, ARKIV_WS_URL    Tiramisu endpoints (defaults to the public RPC)
  ARKIV_ACCESS_KEY               Optional access key (sent as X-API-KEY)
  WATCHER_PRIVATE_KEY            watch: the watcher's wallet (testnet only)
  WATCHER_OPERATOR, WATCHER_REGION, PORT   watch: labels, and an optional /status port
`;

function cfg(): ArkivConfig {
  return {
    ...(process.env.ARKIV_RPC_URL ? { rpcUrl: process.env.ARKIV_RPC_URL } : {}),
    ...(process.env.ARKIV_WS_URL ? { wsUrl: process.env.ARKIV_WS_URL } : {}),
    ...(process.env.ARKIV_ACCESS_KEY ? { accessKey: process.env.ARKIV_ACCESS_KEY } : {}),
  };
}

/** Strips control characters (incl. ESC) from text that came from someone else's entity. */
export const safe = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

export function human(seconds: number): string {
  if (seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86_400), h = Math.floor((seconds % 86_400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${seconds % 60}s` : `${seconds}s`;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const STATUS_COLOR: Record<CaseView["status"], (s: string) => string> = {
  sealed: cyan,
  acknowledged: cyan,
  fixed: green,
  lapsed: yellow,
  revealable: yellow,
  revealed: red,
  disclosed: green,
  withdrawn: dim,
};

function isKey(v: string | undefined): v is Hex {
  return !!v && /^0x[0-9a-fA-F]{64}$/.test(v);
}

async function verify(caseKey: string | undefined, asJson: boolean) {
  if (!isKey(caseKey)) throw new Error("usage: on-the-clock verify <caseKey>  (a 32-byte 0x… entity key)");
  const pub = publicClient(cfg());
  const bundle = await loadCase(pub, caseKey);
  if (!bundle) throw new Error(`no On the Clock case with key ${caseKey} on Tiramisu`);
  const { view } = bundle;
  const reveal = ["revealable", "revealed", "disclosed"].includes(view.status) ? await resolveReveal(pub, bundle) : null;
  if (asJson) {
    console.log(json({ view, reveal }));
    return;
  }
  const sev = SEVERITY[view.sev as Severity] ?? "?";
  console.log(`${bold("case")} ${view.key}`);
  console.log(`${dim("status")}   ${STATUS_COLOR[view.status](view.status)}   ${dim("severity")} ${sev}   ${dim("threshold")} ${view.k}-of-${view.n}`);
  console.log(`${dim("filed by")} ${view.researcher} ${dim("(researcher, immutable $creator)")}`);
  console.log(`${dim("responder")} ${view.responder} ${dim("(the vendor's one-time stealth address)")}`);
  if (view.clock.live) {
    console.log(`${dim("deadline")} block ${view.clock.expiresAt} · ${bold(human(Number(view.blocksLeft) * BLOCK_SECONDS))} left · held by ${view.clock.owner}`);
  } else {
    console.log(`${dim("deadline")} block ${view.expectedExpiry} · ${yellow("clock is gone")}`);
  }
  if (view.unrecordedExtension) console.log(red("! the live clock runs later than any recorded grant explains"));
  console.log(`\n${bold("timeline")}`);
  for (const t of view.timeline) {
    const mark = t.verdict === "verified" ? green("✓") : t.verdict === "premature" ? red("!") : yellow("✗");
    const extra = [t.seconds ? `+${human(t.seconds)}` : "", t.outcome ?? "", t.to ? `→ ${short(t.to)}` : ""].filter(Boolean).join(" ");
    console.log(`  ${mark} block ${String(t.block).padEnd(9)} ${t.kind.padEnd(8)} by ${short(t.by)} ${extra}${t.reason ? dim(`  (${t.reason})`) : ""}`);
  }
  if (view.responderBound === null && view.timeline.some((t) => ["ack", "extreq", "fixed"].includes(t.kind) && t.verdict === "verified")) {
    console.log(dim("  vendor acts are verified against the case's responder address; a reveal binds that address to the vendor"));
  }
  console.log(`\n${dim("receipts")} ${view.receipts.valid}/${view.k} valid${view.receipts.foreign.length ? `, ${view.receipts.foreign.length} from non-watchers ignored` : ""}${view.receipts.premature.length ? red(`, ${view.receipts.premature.length} premature`) : ""}`);
  if (reveal) {
    const ok = reveal.ok ? green("verified") : red("FAILED");
    console.log(`\n${bold("reveal")} ${ok}  ${dim(json(reveal.checks).replace(/\s+/g, " "))}`);
    if (view.vendor) console.log(`  vendor  ${bold(safe(view.vendor.name))} ${dim(view.vendor.address)} ${green("(inbox checked)")}`);
    else console.log(`  vendor  ${yellow(`not confirmed (attribution: ${view.attribution ?? "n/a"})`)}`);
    if (reveal.advisory) {
      console.log(`  title   ${safe(reveal.advisory.title)}`);
      console.log(`  where   ${safe(reveal.advisory.component)}${reveal.advisory.cwe ? ` (${safe(reveal.advisory.cwe)})` : ""}`);
      console.log(`  summary ${safe(reveal.advisory.summary)}`);
    }
  }
}

async function board(asJson: boolean) {
  const b = await loadBoard(publicClient(cfg()));
  const rows = b.cases
    .map((x) => x.view)
    .sort((a, z) => Number((a.clock.live ? a.blocksLeft : 1n << 60n) - (z.clock.live ? z.blocksLeft : 1n << 60n)));
  if (asJson) {
    console.log(json({ head: b.head, cases: rows, watchers: b.watchers.map((w) => ({ address: w.creator, expiresAt: w.expiresAt })) }));
    return;
  }
  console.log(`${bold(`${rows.length} cases`)} · ${b.watchers.length} watchers alive · head ${b.head}\n`);
  for (const v of rows) {
    const left = v.clock.live ? human(Number(v.blocksLeft) * BLOCK_SECONDS) : "—";
    console.log(`  ${STATUS_COLOR[v.status](v.status.padEnd(12))} ${String(SEVERITY[v.sev as Severity] ?? "?").padEnd(8)} ${left.padEnd(9)} ${dim(v.key)}`);
  }
}

async function inboxes(asJson: boolean) {
  const list = currentInboxes(await listInboxes(publicClient(cfg())));
  if (asJson) return console.log(json(list.map((i) => ({ key: i.key, vendor: i.creator, ...i.payload, expiresAt: i.expiresAt }))));
  for (const i of list) console.log(`  ${bold(safe(i.payload?.name).padEnd(28))} sla ${safe(i.payload?.sla)}d · embargo ${safe(i.payload?.embargo)}d · ${dim(i.creator)} ${dim(i.key)}`);
}

function queries(caseKey: string | undefined) {
  if (!isKey(caseKey)) throw new Error("usage: on-the-clock queries <caseKey>");
  console.log(`# the case file and everything that points at it (one query, cursor-paged)
app = "onclock" && ($key = ${caseKey} || case = ${caseKey})

# the live clock (absent once it has lapsed or been deleted)
arkiv_getEntity(<payload.clock>)

# a watcher's proof that the clock lapsed on its own
$key = <clock> && app = "onclock"   @ atBlock(expiresAt - 1)
eth_getLogs(EntityDeleted, entityKey = <clock>)`);
}

async function watch() {
  const pk = process.env.WATCHER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("WATCHER_PRIVATE_KEY is required (a Tiramisu testnet key)");
  const account = privateKeyToAccount(pk);
  const conf = cfg();
  const w = new Watcher({
    pub: publicClient(conf),
    live: liveClient(conf),
    wallet: walletClient(account, conf),
    // The encryption key is derived from the wallet key, so one secret runs a watcher.
    encryptionKey: (process.env.WATCHER_ENC_KEY as Hex | undefined) ?? deriveScalar(hexToBytes(pk), "watcher-encryption"),
    operator: process.env.WATCHER_OPERATOR ?? "independent",
    region: process.env.WATCHER_REGION ?? "unknown",
    version: VERSION,
  });
  if (process.env.PORT) {
    createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.setHeader("access-control-allow-origin", "*");
      res.end(json(w.status()));
    }).listen(Number(process.env.PORT));
  }
  await w.start();
  const shutdown = () => {
    w.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { json: { type: "boolean", default: false }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" } },
  });
  const [cmd, arg] = positionals;
  if (values.version) return console.log(VERSION);
  if (values.help || !cmd) return console.log(HELP);
  switch (cmd) {
    case "verify":
      return verify(arg, !!values.json);
    case "board":
      return board(!!values.json);
    case "inboxes":
      return inboxes(!!values.json);
    case "queries":
      return queries(arg);
    case "watch":
      return watch();
    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(red(safe(e instanceof Error ? e.message : String(e))));
  process.exit(1);
});
