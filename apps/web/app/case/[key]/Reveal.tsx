"use client";
import type { CaseView, RevealChecks, RevealResult } from "on-the-clock-sdk";
import { Hash } from "@/components/Hash";
import { blocks, sevLabel } from "@/components/CaseText";
import s from "./case.module.css";

const CHECKS: { k: keyof RevealChecks; t: string; d: string }[] = [
  { k: "decrypts", t: "Opens the advisory", d: "The key decrypts the advisory sealed when the case was filed." },
  { k: "commitment", t: "Matches the vendor commitment", d: "The named inbox and its salt hash to the commitment written at filing." },
  { k: "delivery", t: "Proves delivery", d: "The case was addressed to this vendor’s viewing key: the ephemeral key and view tag reproduce." },
  { k: "responderBinding", t: "Binds the responder", d: "The responder that acted on the case derives from this vendor’s spending key." },
  { k: "inbox", t: "Inbox checks out", d: "The named inbox was created by the named vendor and carries the same meta-address." },
];

function Vendor({ view }: { view: CaseView }) {
  if (view.attribution === "verified" && view.vendor) {
    return (
      <>
        <p className={s.vname}>{view.vendor.name}</p>
        <p className={s.vmeta}>
          <span>
            wallet <Hash value={view.vendor.address} kind="address" />
          </span>
          <span>
            inbox <Hash value={view.vendor.inbox} />
          </span>
        </p>
        <p className="note">Confirmed: the inbox the reveal names was created by this wallet and carries the keys the case was sent to.</p>
      </>
    );
  }
  const why =
    view.attribution === "mismatch"
      ? "The inbox the reveal names does not match the keys this case was addressed to, so the name it carries is not shown."
      : view.attribution === "unknown"
        ? "The inbox the reveal names could not be read: it may have been deleted, and Tiramisu’s history reaches back only about 11 days. Without it the name cannot be checked."
        : "No reveal is on Arkiv yet. The vendor is named only once a reveal is published and the inbox it names checks out.";
  return (
    <>
      <p className={s.vname}>
        <span className="redact" style={{ width: 168 }} aria-hidden="true" />
        <span className={s.sr}>vendor not confirmed</span>
      </p>
      <p className={view.attribution === "mismatch" ? `${s.bad} ${s.vwhy}` : `soft ${s.vwhy}`}>
        <b>Not confirmed.</b> {why}
      </p>
    </>
  );
}

export function Reveal({ view, reveal }: { view: CaseView; reveal: RevealResult | null }) {
  if (!reveal) {
    return (
      <section className={`panel ${s.reveal}`} aria-labelledby="reveal-h">
        <h2 id="reveal-h">The reveal</h2>
        <p className={`${s.loading} mono`} role="status">
          <i className="lamp blink-a" />
          rebuilding the advisory key from Arkiv and checking it…
        </p>
      </section>
    );
  }
  const a = reveal.advisory;
  const entity = view.reveal;
  return (
    <section className={`panel ${s.reveal}`} aria-labelledby="reveal-h">
      <p className="eyebrow">
        <i />
        {view.status === "disclosed" ? "Disclosed early by the researcher" : "Published by the deadline"}
      </p>
      {a ? (
        <>
          <h2 id="reveal-h" className={s.atitle}>
            {a.title}
          </h2>
          <div className={s.atags}>
            <span className={`tag ${a.severity >= 4 ? "brass" : ""}`}>{sevLabel(a.severity)}</span>
            {a.cwe && <span className="tag">{a.cwe}</span>}
            <span className="mono soft">{a.component}</span>
          </div>
          <p className={s.summary}>{a.summary}</p>
          <p className="note">Credited to {a.researcher}. The full report stays sealed and the proof of concept was never on Arkiv: the protocol releases neither.</p>
        </>
      ) : (
        <h2 id="reveal-h" className={s.atitle}>
          The published key does not open this case’s advisory.
        </h2>
      )}

      <div className={s.rgrid}>
        <div>
          <h3 className={s.h3}>Vendor</h3>
          <Vendor view={view} />
        </div>
        <div>
          <h3 className={s.h3}>Checks, recomputed in this browser</h3>
          {!(reveal.checks.decrypts && reveal.checks.commitment && reveal.checks.delivery && reveal.checks.responderBinding) && (
            <p className={s.bad} style={{ marginBottom: 10 }}>
              This key fails a check, so nothing it claims about the vendor is trusted.
            </p>
          )}
          <ul className={s.checks}>
            {CHECKS.map((c) => {
              const v = reveal.checks[c.k];
              return (
                <li key={c.k}>
                  <span className={`${s.vmark} ${v === true ? s.verified : v === false ? s.ignored : s.unchecked}`} aria-hidden="true">
                    {v === true ? "✓" : v === false ? "✗" : "–"}
                  </span>
                  <div>
                    <p className={s.ctitle}>
                      {c.t} <span className={s.sr}>{v === true ? "passed" : v === false ? "failed" : "not checked"}</span>
                    </p>
                    <p className={s.cdesc}>{v === null ? "Not checked: the named inbox could not be read." : c.d}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <p className={s.rfoot}>
        {entity ? (
          <>
            Key published by the {entity.payload.by === "researcher" ? "researcher" : "watchers"} at block {blocks(entity.createdAt)} in{" "}
            <Hash value={entity.key} />. Its author does not matter: the key is trusted only because it passes these checks.
          </>
        ) : (
          <>No reveal entity is on Arkiv yet. This key was rebuilt in your browser from {view.receipts.valid} published watcher shares.</>
        )}
      </p>
    </section>
  );
}
