"use client";
import Link from "next/link";
import { BLOCK_SECONDS, SEVERITY, type Severity } from "on-the-clock-sdk";
import { Movement, Vault } from "@/components/Vault";
import { useBoard, useHead, useSecondsUntil, human } from "@/lib/hooks";
import { short } from "@/components/Hash";

const STEPS = [
  {
    verb: "File it sealed",
    body: "The researcher writes one batch: the encrypted report, a clock whose Arkiv lifetime is the embargo, and three escrowed key shares. The case file is handed to 0x…dEaD in the same transaction, so nobody can edit or delete it.",
    tech: "atomic batch · Entity Expiration · readonly",
  },
  {
    verb: "The vendor answers, unseen",
    body: "The case is addressed with an ERC-5564 stealth key. Only the vendor can find it, and it answers from a one-time address. The explorer shows that someone acknowledged; it cannot show who.",
    tech: "stealth inbox · $creator = responder",
  },
  {
    verb: "Only the researcher moves the deadline",
    body: "An extension is a Lifetime Extension on the clock, and only its owner can do it. A vendor's attempt reverts on chain. Granting more time moves the clock and every escrowed share in one batch, with a record of it.",
    tech: "extendEntity · NotOwner · changeOwnership",
  },
  {
    verb: "The deadline publishes itself",
    body: "Arkiv emits nothing when a lifetime runs out. Three independent watchers notice the clock is gone, prove nobody deleted it, and publish their shares. Two of three rebuild the key: the advisory and the vendor's name decrypt for everyone.",
    tech: "watchers · WebSocket events · k-of-n release",
  },
];

const REFUSALS = [
  { what: "The vendor tries to push the deadline back", how: "reverts: the vendor does not own the clock", stamp: "refused" },
  { what: "Anyone tries to edit or delete the sealed case file", how: "reverts: its owner is 0x…dEaD", stamp: "refused" },
  { what: "A stranger writes \"acknowledged\" or \"fixed\" for the vendor", how: "ignored: written by someone other than the case's responder", stamp: "ignored" },
  { what: "A copy of an escrowed share, aimed at a clock that ends sooner", how: "rejected: each share only opens for its own clock", stamp: "rejected" },
  { what: "A reveal that names the wrong vendor", how: "mismatch: the named inbox does not match the keys the case was sent to", stamp: "mismatch" },
];

export default function Home() {
  const { head, at } = useHead();
  const { board } = useBoard();
  const live = (board?.cases ?? []).filter((c) => c.view.clock.live).sort((a, b) => (a.view.clock.expiresAt < b.view.clock.expiresAt ? -1 : 1));
  const featured = live[0]?.view;
  const secs = useSecondsUntil(featured?.clock.expiresAt, head, at);
  const watchers = (board?.watchers ?? []).slice(0, 3);
  const hours = secs === null ? null : secs / 3600;

  return (
    <>
      <main className="hero">
        <Vault head={head} />
        <div className="core">
          <p className="eyebrow reveal">
            <i />
            Time-locked disclosure
            <i />
          </p>
          <h1 className="hero-h1 reveal d2">A disclosure deadline that enforces itself.</h1>
          <p className="sub reveal d3">
            File a vulnerability report the vendor can’t stall and nobody can bury. When the embargo runs out, the advisory publishes itself — no
            platform, no promise, no one to ask.
          </p>
          <div className="ctas reveal d4">
            <Link className="btn" href="/demo">
              Watch a deadline run
              <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.4" />
                <path d="M7 3.6V7l2.4 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </Link>
            <Link className="link" href="/file">
              File a report
            </Link>
          </div>
          <div className="movements reveal d4" aria-label="Watcher movements">
            {[0, 1, 2].map((i) => (
              <Movement
                key={i}
                label={`mvmt ${["I", "II", "III"][i]}`}
                alive={!!watchers[i]}
                hoursLeft={hours === null ? null : hours + i * 0.012}
                blink={["blink-a", "blink-b", "blink-c"][i]}
              />
            ))}
          </div>
          <p className="mvcap reveal d4">
            {watchers.length ? `${watchers.length} independent watcher${watchers.length > 1 ? "s" : ""} on duty. Any two release the key — the vendor holds none.` : "Three independent watchers. Any two release the key — the vendor holds none."}
          </p>
        </div>
        {featured ? (
          <Link className="case mono" href={`/case/${featured.key}`}>
            case <b>{short(featured.key)}</b> · severity <span className="crit">{SEVERITY[featured.sev as Severity] ?? "?"}</span> · vendor{" "}
            <span className="bar">▇▇▇▇▇▇</span> · <b>{human(secs)}</b> left
          </Link>
        ) : board ? (
          <Link className="case mono" href="/demo">
            no clock is running right now · <b>start one</b> →
          </Link>
        ) : (
          <p className="case mono">
            reading Arkiv… block <b>{head ? head.toString() : "…"}</b>
          </p>
        )}
      </main>

      <section className="page" id="how">
        <p className="eyebrow">
          <i />
          How it works
        </p>
        <h2 className="h-section">Four moves, and the database keeps the time.</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.verb}>
              <span className="step-n mono">0{i + 1}</span>
              <h3>{s.verb}</h3>
              <p>{s.body}</p>
              <span className="tag">{s.tech}</span>
            </li>
          ))}
        </ol>

        <div className="split">
          <div>
            <p className="eyebrow">
              <i />
              What it refuses
            </p>
            <h2 className="h-section">Every way around the clock, and what happens.</h2>
            <p className="lede">
              Anyone can write anything to Arkiv. What counts is decided by who wrote it — the immutable <span className="mono">$creator</span> — and
              by recomputation, never by a field someone filled in. Each of these is on chain with its transaction.
            </p>
            <Link className="link" href="/proof" style={{ display: "inline-block", marginTop: 18 }}>
              See every refusal on the explorer
            </Link>
          </div>
          <ul className="refusals">
            {REFUSALS.map((r) => (
              <li key={r.what}>
                <div>
                  <b>{r.what}</b>
                  <span>{r.how}</span>
                </div>
                <span className={`stamp ${r.stamp === "refused" ? "rust" : "ink"}`}>{r.stamp}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="split">
          <div>
            <p className="eyebrow">
              <i />
              What the explorer sees
            </p>
            <h2 className="h-section">A clock, a blob, and an address with no history.</h2>
            <p className="lede">
              While the embargo runs, the public record shows that a case exists, how severe it is and when it ends. Not the vendor, not the title,
              not the report. The proof of concept never touches Arkiv at all — only its hash.
            </p>
          </div>
          <div className="explorer-pair">
            <div className="panel">
              <p className="tag brass">public</p>
              <dl className="kv mono" style={{ marginTop: 14, fontSize: 13 }}>
                <dt>kind</dt>
                <dd>case</dd>
                <dt>sev</dt>
                <dd>4</dd>
                <dt>$creator</dt>
                <dd>0x6aB9…d613</dd>
                <dt>$owner</dt>
                <dd>0x…dEaD</dd>
                <dt>payload</dt>
                <dd>6 312 bytes of ciphertext</dd>
                <dt>clock</dt>
                <dd>expires at block {head ? (head + 111_780n).toString() : "…"}</dd>
              </dl>
            </div>
            <div className="panel">
              <p className="tag">not on the explorer</p>
              <ul className="hidden-list">
                <li>which vendor</li>
                <li>title and component</li>
                <li>the full report</li>
                <li>the proof of concept (never on Arkiv)</li>
                <li>who the researcher is</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="split">
          <div>
            <p className="eyebrow">
              <i />
              Check it without us
            </p>
            <h2 className="h-section">Our site is a convenience. The record is not ours.</h2>
            <p className="lede">
              Every verdict on this site is rebuilt in your browser from Arkiv. You can rebuild it without the site: one command, straight against the
              public RPC.
            </p>
          </div>
          <div className="stack">
            <code className="code">npx on-the-clock board{"\n"}npx on-the-clock verify &lt;caseKey&gt;</code>
            <code className="code">{`app = "onclock" && ($key = <case> || case = <case>)`}</code>
            <p className="note">
              One query returns the case file and everything that points at it. The full data contract is in{" "}
              <a className="ext" href="https://github.com/RaYYeR220/on-the-clock/blob/main/arkiv/schema.md" target="_blank" rel="noreferrer">
                arkiv/schema.md
              </a>
              .
            </p>
          </div>
        </div>

        <div className="cta-band">
          <h2 className="h-section">Watch one run, start to finish, in about three minutes.</h2>
          <p className="lede">A throwaway wallet, real transactions on Tiramisu, a vendor that tries to cheat, and a deadline that publishes itself.</p>
          <div className="row" style={{ marginTop: 22, gap: 22 }}>
            <Link className="btn" href="/demo">
              Start the demo
            </Link>
            <Link className="link" href="/board">
              See the live board
            </Link>
          </div>
          <p className="note" style={{ marginTop: 16 }}>
            Block time {BLOCK_SECONDS}s. Everything here is testnet and synthetic.
          </p>
        </div>
      </section>
    </>
  );
}
