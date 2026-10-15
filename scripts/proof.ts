// Renders ../PROOF.md from the newest ../proof/e2e-*.json: every claim as an explorer link.
//   node proof.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const EXPLORER = "https://tiramisu.explorer.arkiv.network";
const tx = (h?: unknown) => (typeof h === "string" && h.startsWith("0x") ? `[${h.slice(0, 10)}…](${EXPLORER}/tx/${h})` : "—");
const ent = (k?: unknown) => (typeof k === "string" && k.startsWith("0x") ? `[${k.slice(0, 10)}…](${EXPLORER}/entity/${k})` : "—");

type Step = Record<string, unknown> & { name: string; at: string };
const files = readdirSync("../proof").filter((f) => /^e2e-\d+\.json$/.test(f)).sort();
const latest = files.at(-1);
if (!latest) throw new Error("no ../proof/e2e-*.json yet: run e2e.ts first");
const run = JSON.parse(readFileSync(`../proof/${latest}`, "utf8")) as { startedAt: string; finishedAt: string; steps: Step[]; config: Record<string, unknown> };
const s = (prefix: string) => run.steps.find((x) => x.name.startsWith(prefix));
const all = (prefix: string) => run.steps.filter((x) => x.name.startsWith(prefix));

const inbox = s("vendor opened");
const filed = s("researcher filed");
const ack = s("vendor acknowledged");
const req = s("vendor asked");
const grant = s("researcher granted");
const forged = s("impostor wrote");
const derived = s("case as derived");
const fixed = s("vendor marked");
const final = s("final state");
const rejections = (s("watcher rejections")?.rejections as Record<string, unknown>[] | undefined) ?? [];
const receipts = (final?.receipts as { key: string; by: string; block: string; outcome: string }[] | undefined) ?? [];

const lines: string[] = [];
const L = (x = "") => lines.push(x);

L("# Proof");
L();
L(`Everything below happened on **Tiramisu** (chain 7738577) between ${run.startedAt} and ${run.finishedAt}, produced by \`scripts/e2e.ts\`.`);
L("Every row links to the explorer. The raw record is [`proof/" + latest + "`](proof/" + latest + ").");
L();
L(`Configuration: embargo ${run.config.embargoSeconds}s, extension ${run.config.grantSeconds}s, ${run.config.k}-of-${run.config.n} watchers${run.config.deployedWatchers ? " (the deployed watchers)" : " (run in-process)"}.`);
L();
L("## The case, from filing to self-publication");
L();
L("| Step | Who | Transaction | Entity |");
L("|---|---|---|---|");
L(`| Vendor opens an inbox | vendor wallet | ${tx(inbox?.tx)} | ${ent(inbox?.inbox)} |`);
L(`| Researcher files: case + clock + 3 triggers, sealed, one batch | researcher | ${tx(filed?.tx)} | ${ent(filed?.case)} |`);
L(`| Researcher pays the vendor's responder its gas | researcher | ${tx(filed?.postageTx)} | — |`);
L(`| Vendor acknowledges from its one-time responder | responder | ${tx(ack?.tx)} | ${ent(ack?.entity)} |`);
L(`| Vendor asks for more time | responder | ${tx(req?.tx)} | ${ent(req?.entity)} |`);
L(`| Researcher grants it: clock + triggers + record, one batch | researcher | ${tx(grant?.tx)} | — |`);
L(`| Vendor marks it fixed | responder | ${tx(fixed?.tx)} | ${ent(fixed?.entity)} |`);
for (const r of receipts) L(`| Watcher publishes a \`${r.outcome}\` receipt at block ${r.block} | ${r.by.slice(0, 10)}… | — | ${ent(r.key)} |`);
L(`| Reveal: advisory key published and verified | watcher | — | ${ent(final?.revealEntity)} |`);
L();
L(`Final status: **${final?.status}**, reveal verified: **${final?.revealOk}**, vendor attribution: **${final?.attribution}**${final?.vendor ? ` (${final.vendor})` : ""}.`);
L();
L(`Checks: \`${JSON.stringify(final?.checks)}\``);
L();
L("## Refusals");
L();
L("What the protocol refuses, and how. A reverted transaction is linked when the attempt was mined.");
L();
L("| Attempt | Expected | Observed | Transaction |");
L("|---|---|---|---|");
for (const r of all("refused:")) {
  L(`| ${r.name.replace("refused: ", "")} | revert | ${r.reverted ? `reverted: ${String(r.error).slice(0, 90)}` : "**NOT reverted**"} | ${tx(r.tx)} |`);
}
L();
L("## Forgeries anyone can write, none of which count");
L();
L(`The impostor wallet wrote a fake acknowledgement, a fake fix, a fake lapse receipt, a fake reveal, a decoy clock and a copy of a real escrowed share aimed at the decoy clock (${tx(forged?.tx)}). Arkiv accepts all of them: anyone can write anything. The state derived from Arkiv ignores every one, by \`$creator\` or by recomputation:`);
L();
for (const i of (derived?.ignored as string[] | undefined) ?? []) L(`- ${i}`);
L();
L(`Watcher rejections of the copied escrow (it never released anything): ${rejections.length}`);
for (const r of rejections) L(`- ${String(r.watcher)}: ${String(r.reason)} (${ent(r.trigger)})`);
L();
writeFileSync("../PROOF.md", lines.join("\n") + "\n");
console.log(`PROOF.md written from ${latest}`);
