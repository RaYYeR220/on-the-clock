import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BLOCK_SECONDS, LIFETIME } from "on-the-clock-sdk";
import { Schematic } from "@/components/Schematic";
import css from "./how.module.css";

export const metadata: Metadata = {
  title: "How it works · On the Clock",
  description: "The whole protocol: one Arkiv entity's lifetime is the disclosure deadline, and everything else is proof anyone can re-check.",
};

const minutes = (s: number) => s / 60;
const days = (s: number) => s / 86_400;

const TOC = [
  ["flow", "The flow"],
  ["why-arkiv", "Why Arkiv"],
  ["off-arkiv", "Off Arkiv"],
  ["features", "Arkiv, feature by feature"],
  ["threats", "Threat model"],
  ["mistakes", "Our own mistakes"],
  ["limits", "Honest limits"],
] as const;

const HOSTS = [
  {
    host: "Postgres",
    breaks:
      "Whoever holds the admin password can move the date or drop the row, and nobody outside can tell it happened. The deadline is enforced by a cron job someone has to keep running.",
  },
  {
    host: "IPFS",
    breaks:
      "The content is fixed, but nothing about a CID knows a deadline or expires. Pinning is someone’s choice, authorship has to be bolted on with signatures, and there is no query for “every case ending this week”.",
  },
  {
    host: "A contract and a subgraph",
    breaks:
      "The deadline becomes a storage slot whose guard you write and audit yourself, ciphertext is expensive to keep in contract storage, and every read goes through an indexer someone hosts.",
  },
  {
    host: "Our own API",
    breaks: "We become the party that can be leaned on, by either side. If we go offline, the deadlines go with us.",
  },
];

const OFF = [
  ["The proof of concept", "Only its SHA-256 hash. A working exploit on a public database would be the worst mistake this product could make."],
  [
    "The full report, readable",
    "On Arkiv only as ciphertext for the vendor. Its key is never released by the protocol, not even at the deadline: the reveal opens the advisory summary, not the report.",
  ],
  [
    "The vendor, while the case is open",
    "An entity saying “vendor X has an open critical, nine days left” is targeting intelligence. Until the reveal, the vendor is a stealth address.",
  ],
  ["Correspondence, triage, the patch", "Vendor notes are optional and encrypted to the researcher."],
  ["Real identities", "Researchers are wallets. All demo data is synthetic."],
  ["Secrets", "Watchers hold their shares in memory and re-derive them from the chain on restart. Nothing secret is written in plaintext."],
] as const;

const FEATURES = [
  {
    f: "Attributes vs payload",
    how: (
      <>
        Attributes carry only what is queried: <code>kind</code>, <code>case</code>, <code>sev</code>, <code>watcher</code>, <code>vendor</code>.
        Everything else is a JSON payload, mostly ciphertext.
      </>
    ),
    see: "The board filters by severity without opening a single report.",
  },
  {
    f: "Compound queries",
    how: (
      <>
        <code>{`app = "onclock" && ($key = C || case = C)`}</code> returns a case file and everything that points at it, cursor-paged.
      </>
    ),
    see: "A case page is one query, and the CLI prints it so you can run it yourself.",
  },
  {
    f: "Entity Expiration, per type",
    how: `Clock: the deadline. Triggers: the deadline plus ${days(LIFETIME.triggerGrace)} days. Records: ${days(LIFETIME.record)} days. Inbox: a ${days(LIFETIME.inboxLease)}-day lease. Watcher: a ${minutes(LIFETIME.watcherLease)}-minute lease.`,
    see: "Every lifetime says what the entity means.",
  },
  {
    f: "Lifetime Extension as a lease",
    how: `Watchers renew their lease every ${minutes(LIFETIME.watcherHeartbeat)} minutes; an inbox is renewed by its vendor’s activity.`,
    see: "The watchers page: present means alive.",
  },
  {
    f: "Lifetime Extension as a grant",
    how: "The custodian extends the clock and every trigger, and writes a grant record, in one batch.",
    see: "A granted extension moves the countdown on the case page.",
  },
  {
    f: "Creation flags",
    how: (
      <>
        <code>readonly</code> on every record, so nothing is edited after the fact. <code>permissionlessExtension</code> on case files, triggers,
        receipts and reveals so anyone can keep evidence alive, and deliberately off on the clock.
      </>
    ),
    see: "Anyone can keep an advisory alive. Only the custodian can keep a deadline alive.",
  },
  {
    f: "$creator, $owner, changeOwnership",
    how: (
      <>
        <code>$creator</code> decides whose act counts; <code>$owner</code> decides who can extend. <code>changeOwnership</code> seals the case file
        and triggers to 0x…⁠dEaD at filing, and hands a clock to a coordinator.
      </>
    ),
    see: "Acts from the wrong address show as ignored on the case timeline.",
  },
  {
    f: "watchEntityEvents over WebSocket",
    how: "Watchers reschedule on ExpiryExtended and treat EntityDeleted as a withdrawal. The site refreshes on events from a case’s known authors.",
    see: "Countdowns move the moment an extension lands, without a reload.",
  },
  {
    f: "Atomic batches",
    how: "Filing, granting, handing off, disclosing early and the lapse are each one transaction.",
    see: "There is never a clock without escrow, or an extension without its record.",
  },
  {
    f: "Historical queries",
    how: (
      <>
        <code>atBlock(deadline − 1)</code> shows the clock was alive just before it lapsed, which together with the delete logs separates a lapse
        from a withdrawal.
      </>
    ),
    see: "Each receipt records the block it checked.",
  },
];

const PARTIES = [
  {
    who: "Vendor",
    as: "through a stealth inbox",
    can: "Find its own cases, acknowledge, ask for time and mark fixed, each from a one-time address. Stay silent: the deadline runs anyway.",
    cannot:
      "Extend the clock (reverts NotOwner), edit or delete the case file (owned by 0x…⁠dEaD), or read the advisory early: it holds no shares. Deleting its inbox does not dodge the name: the reveal checks the inbox as it stood at filing.",
  },
  {
    who: "Researcher",
    as: "the case’s $creator",
    can: "Grant extensions, hand the clock to a coordinator, disclose early, or withdraw by deleting the clock. Each of these leaves a public record.",
    cannot:
      "Get the watchers to release before the filed deadline, name a vendor the case was not sent to, or back-date a grant: receipts are judged by the clock’s on-chain logs.",
  },
  {
    who: "Coordinator",
    as: "after a handoff",
    can: "Everything the researcher could do with the deadline, once the clock is handed over. The handoff is a record of its own.",
    cannot: "Read the report or the advisory early. It holds the clock, not the keys.",
  },
  {
    who: "Watchers",
    as: "one share each",
    can: "Publish their share after the deadline, or refuse to: release needs k of the n. If k of them collude, they could rebuild K and release before the deadline.",
    cannot:
      "Do that unnoticed: a watcher reveal written before the deadline is flagged on the case as an early release. One watcher alone learns nothing, and none of them can read the report.",
  },
  {
    who: "Anyone",
    as: "any wallet",
    can: "Write any entity with any attributes: fake acknowledgements, fake receipts, bogus reveals, decoy clocks. Keep evidence alive with a Lifetime Extension.",
    cannot: "Make any of it count. Every verdict is a $creator check or a recomputation, so forgeries show up as ignored.",
  },
  {
    who: "Tiramisu",
    as: "the chain",
    can: "Today a single block producer orders every transaction. It could delay or drop a receipt, a grant or a reveal.",
    cannot: "Forge $creator or read ciphertext. Censorship shows up as a receipt that is missing, never as one that is false.",
  },
];

const MISTAKES = [
  {
    title: "A copied share aimed at a sooner clock",
    what: "A trigger’s share was bound to its case and nothing else. Anyone could copy the ciphertext into a new trigger pointing at a clock they controlled, set to lapse sooner, and the watcher would release on that clock’s schedule.",
    fix: "Each share is encrypted with the case, the clock and the watcher as associated data. Moved to any other clock it does not decrypt, and a watcher only accepts triggers written by the case’s researcher for the clock the case file names.",
  },
  {
    title: "One “withdrawn” outvoting k lapse receipts",
    what: "The status logic looked for a withdrawal before it counted shares, so a single watcher claiming the clock had been deleted could mark a lapsed case withdrawn and hide a reveal that k shares had already made possible.",
    fix: "k verified shares always win. A withdrawal needs the same threshold of watchers, or a clock gone before its deadline, to stand.",
  },
  {
    title: "A bogus reveal blocking the real one",
    what: "The first reveal entity on a case was taken as the reveal. Anyone could post one early with a key that opened nothing, and the real reveal behind it would be ignored.",
    fix: "A reveal counts only if its key opens the case: it decrypts the advisory, opens the vendor commitment, proves delivery and binds the responder. Who posted it does not matter.",
  },
  {
    title: "A forged clock",
    what: "Anyone could create an entity with kind = clock pointing at a case, with whatever expiry they liked, and the app could read it as that case’s deadline.",
    fix: "Only the clock the case file committed to, by key, written by the case’s own researcher, counts. Every other “clock” is noise.",
  },
  {
    title: "A researcher naming another vendor’s inbox",
    what: "The vendor’s name at reveal comes from a bundle the researcher wrote. A case sent to one vendor could be revealed blaming another.",
    fix: "The named inbox must be created by the named vendor and carry the exact stealth keys the case was sent to. Otherwise the case shows a mismatch and names nobody.",
  },
  {
    title: "A reveal “proving” delivery to a vendor who never received it",
    what: "The check derived the responder from the vendor’s public key, which anyone can do whether or not the case was ever findable by that vendor.",
    fix: "The reveal opens the addressing key, so anyone can recompute the ephemeral key, the view tag and the responder from the vendor’s keys. Opening it would have exposed the report too, so the report is now sealed under a second key that is never opened.",
  },
  {
    title: "Grant records the chain never applied",
    what: "Receipts were judged against the deadline the grant records claimed. A grant entity written without the Lifetime Extension behind it made honest lapse receipts look premature.",
    fix: "Once the clock is gone, receipts are judged by its own on-chain logs: the EntityCreated expiry and every ExpiryExtended after it. A grant the chain never applied is flagged, not trusted.",
  },
];

const LIMITS = [
  ["Testnet only", "Everything runs on Tiramisu with synthetic data. Nothing here protects a real vulnerability today."],
  [
    "The demo watchers are ours",
    "The three watchers in this demo are run by the project, on three separate machines. The protocol lets anyone run one and a case can name any watchers, but independence only becomes real with independent operators.",
  ],
  ["A single block producer", "Tiramisu has one today. It cannot forge authorship or decrypt anything, but it could delay or censor transactions."],
  [
    "Responder gas comes from the researcher",
    "The one-time responder needs gas, so the researcher sends it in a plain transfer. That does not link the vendor, but it does link the researcher’s wallet to the case’s responder.",
  ],
  [
    `Deadlines are ${BLOCK_SECONDS} s blocks`,
    "A deadline is a block height, not a timestamp. Watchers check every few seconds, so a release lands a few blocks after the deadline, never before it.",
  ],
  [
    "History reaches back about 11 days",
    "If a vendor deletes its inbox and the case was filed longer ago than that, attribution reads “unknown” instead of naming anyone.",
  ],
] as const;

function Heading({ n, eyebrow, children }: { n: string; eyebrow: string; children: ReactNode }) {
  return (
    <>
      <p className="eyebrow">
        <i />
        {n} · {eyebrow}
      </p>
      <h2 className="h-section">{children}</h2>
    </>
  );
}

export default function HowPage() {
  return (
    <main className={`page ${css.how}`}>
      <header className={css.head}>
        <p className="eyebrow">
          <i />
          How it works
        </p>
        <h1 className={`h-page ${css.h}`}>One entity’s lifetime is the deadline. Everything else is proof.</h1>
        <p className="lede">
          On the Clock files a vulnerability report as a handful of Arkiv entities. The embargo is the Entity Expiration of one of them, so the
          deadline is kept by the chain, not by a person or a platform. Below: the whole flow, why it needs Arkiv, what never goes on Arkiv, and where
          it can still fail.
        </p>
      </header>

      <section id="flow" className={css.section} style={{ marginTop: 72 }}>
        <p className="eyebrow">
          <i />
          One case, start to finish
        </p>
        <Schematic />
      </section>

      <div className={css.body}>
        <nav className={css.toc} aria-label="On this page">
          <p className="eyebrow">On this page</p>
          {TOC.map(([id, label], i) => (
            <a key={id} href={`#${id}`}>
              <span>0{i}</span>
              {label}
            </a>
          ))}
        </nav>

        <div className={css.sections}>
          <section id="why-arkiv" className={css.section}>
            <Heading n="01" eyebrow="Why Arkiv">
              Every place you could keep the date belongs to someone in the dispute.
            </Heading>
            <p>
              A disclosure deadline is a disagreement waiting to happen. The vendor wants more time, the researcher wants a date that holds, and whoever
              stores the date can be asked, paid or ordered to move it. So the question is not where to keep a timestamp. It is who can change it, and
              who can check.
            </p>
            <ul className={css.rows}>
              <li className={css.rowsHead}>
                <b>If the date lived in</b>
                <span>What breaks</span>
              </li>
              {HOSTS.map((h) => (
                <li key={h.host}>
                  <b>{h.host}</b>
                  <span>{h.breaks}</span>
                </li>
              ))}
            </ul>
            <div className={css.gives}>
              <div>
                <h3>Entity Expiration enforces the deadline</h3>
                <p>
                  The clock is an entity whose lifetime is the embargo. Only its owner can apply a Lifetime Extension; the vendor’s attempt reverts on
                  chain. When the lifetime ends the entity is gone, whether or not anyone is watching.
                </p>
              </div>
              <div>
                <h3>$creator settles authorship</h3>
                <p>
                  The chain records who wrote each entity, and nobody can change it. A vendor act counts only if the case’s responder wrote it, a
                  grant only if the custodian did. Attributes and payloads are claims; <code>$creator</code> is not.
                </p>
              </div>
              <div>
                <h3>Anyone can query it without us</h3>
                <p>
                  This site reads Arkiv from your browser through the public RPC, and <code>npx on-the-clock verify &lt;case&gt;</code> rebuilds every
                  verdict from a terminal. If the site disappears, the cases do not.
                </p>
              </div>
            </div>
          </section>

          <section id="off-arkiv" className={css.section}>
            <Heading n="02" eyebrow="Off Arkiv, on purpose">
              The public record carries a case, never the exploit.
            </Heading>
            <p>Some things are kept off the chain entirely, and some go on it only as ciphertext. Each of these is a decision, not an omission.</p>
            <ul className={css.off}>
              {OFF.map(([what, why]) => (
                <li key={what}>
                  <b>{what}</b>
                  <span>{why}</span>
                </li>
              ))}
            </ul>
            <div className={css.callout}>
              <b>Expiry is not erasure.</b>
              <p>
                Arkiv keeps payloads in transaction calldata: an expired entity drops out of query results, not out of history. That is why every
                confidential field is encrypted, and why nothing here relies on a short lifetime to keep a secret.
              </p>
            </div>
          </section>

          <section id="features" className={css.section}>
            <Heading n="03" eyebrow="Arkiv, feature by feature">
              Each feature does a job you can see.
            </Heading>
            <ul className={`${css.rows} ${css.three}`}>
              <li className={css.rowsHead}>
                <b>Feature</b>
                <span>How it is used</span>
                <span>Where you see it</span>
              </li>
              {FEATURES.map((r) => (
                <li key={r.f}>
                  <b>{r.f}</b>
                  <span>{r.how}</span>
                  <span>{r.see}</span>
                </li>
              ))}
            </ul>
          </section>

          <section id="threats" className={css.section}>
            <Heading n="04" eyebrow="Threat model">
              Who can do what, and what it would take.
            </Heading>
            <p>
              Anyone can write anything to Arkiv, so the model starts from that. What counts is decided by who wrote it and by recomputation, which
              leaves each party a short list of real powers.
            </p>
            <ul className={`${css.rows} ${css.three} ${css.parties}`}>
              <li className={css.rowsHead}>
                <b>Party</b>
                <span>Can</span>
                <span>Cannot</span>
              </li>
              {PARTIES.map((p) => (
                <li key={p.who}>
                  <span className={css.who}>
                    <b>{p.who}</b>
                    <small>{p.as}</small>
                  </span>
                  <span>
                    <em className={css.mlabel}>Can</em>
                    {p.can}
                  </span>
                  <span>
                    <em className={css.mlabel}>Cannot</em>
                    {p.cannot}
                  </span>
                </li>
              ))}
            </ul>
            <div className={css.callout}>
              <b>If k watchers collude</b>
              <p>
                They can rebuild K before the deadline and publish it. The protocol cannot stop that; it can only make it visible, as a reveal whose
                block is earlier than the clock’s expiry. The defence is choosing watchers whose operators do not answer to each other, which is why
                anyone can run one.
              </p>
            </div>
          </section>

          <section id="mistakes" className={css.section}>
            <Heading n="05" eyebrow="Engineering notes">
              Mistakes we found in our own design while building it, and the fix.
            </Heading>
            <p>
              Each of these was a real hole in an earlier version. The fixes live in code anyone can run: the SDK’s state derivation and the watcher.
            </p>
            <ol className={css.notes}>
              {MISTAKES.map((m) => (
                <li key={m.title}>
                  <h3>{m.title}</h3>
                  <p>{m.what}</p>
                  <p className={css.fix}>
                    <span className="tag brass">now</span>
                    <span>{m.fix}</span>
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section id="limits" className={css.section}>
            <Heading n="06" eyebrow="Honest limits">
              What this does not do yet.
            </Heading>
            <ul className={css.limits}>
              {LIMITS.map(([title, body]) => (
                <li key={title}>
                  <b>{title}</b>
                  <span>{body}</span>
                </li>
              ))}
            </ul>
            <div className={css.end}>
              <Link className="btn" href="/demo">
                Watch a deadline run
              </Link>
              <Link className="link" href="/watchers">
                See the watchers on duty
              </Link>
              <a className="link" href="https://github.com/RaYYeR220/on-the-clock/blob/main/arkiv/schema.md" target="_blank" rel="noreferrer">
                Read the data contract
              </a>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
