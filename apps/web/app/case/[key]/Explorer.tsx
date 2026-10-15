"use client";
import { useEffect, useState } from "react";
import { bytesToHex, type Hex } from "viem";
import type { FullEntity } from "@arkiv-network/sdk";
import { SEALED_OWNER } from "on-the-clock-sdk";
import { Hash } from "@/components/Hash";
import { blocks } from "@/components/CaseText";
import { entityUrl, readClient } from "@/lib/arkiv";
import s from "./case.module.css";

const HEX_SHOWN = 96;

/** The case entity exactly as any explorer returns it: no decoding, no verdicts. */
export function Explorer({ caseKey, out }: { caseKey: Hex; out: boolean }) {
  const [raw, setRaw] = useState<FullEntity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    readClient()
      .getEntity(caseKey)
      .then((e) => on && setRaw(e))
      .catch((e: unknown) => on && setError(e instanceof Error ? e.message.split("\n")[0]! : String(e)));
    return () => {
      on = false;
    };
  }, [caseKey]);

  const sealed = raw ? raw.owner.toLowerCase() === SEALED_OWNER.toLowerCase() : false;
  const hex = raw ? bytesToHex(raw.payload).slice(2) : "";

  return (
    <section className={s.explorer} aria-labelledby="explorer-h">
      <div className={s.exHead}>
        <p className="eyebrow">
          <i />
          What the explorer sees
        </p>
        <h2 id="explorer-h" className={s.h2} style={{ marginTop: 12 }}>
          The case file, as anyone can read it.
        </h2>
      </div>
      <div className={s.exGrid}>
        <div className="panel">
          <div className="panel-head">
            <span className="tag brass">public</span>
            <a className="ext note" href={entityUrl(caseKey)} target="_blank" rel="noreferrer">
              open on the explorer
            </a>
          </div>
          {!raw ? (
            <p className={`${s.loading} mono`} role="status" style={{ marginTop: 0 }}>
              {error ? (
                `could not read the raw entity: ${error}`
              ) : (
                <>
                  <i className="lamp blink-a" />
                  reading the raw entity…
                </>
              )}
            </p>
          ) : (
            <>
              <table className={s.attrs}>
                <caption className={s.sr}>Attributes as stored</caption>
                <thead>
                  <tr>
                    <th scope="col">attribute</th>
                    <th scope="col">type</th>
                    <th scope="col">value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(raw.attributes).map(([name, a]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="muted">{a.type}</td>
                      <td>{String(a.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className={`kv mono ${s.exKv}`}>
                <dt>$creator</dt>
                <dd>
                  <Hash value={raw.creator} kind="address" />
                </dd>
                <dt>$owner</dt>
                <dd>
                  <Hash value={raw.owner} kind="address" />
                  {sealed && <span className={s.why}>a burn address: nobody can sign for it, so nobody can edit or delete the file</span>}
                </dd>
                <dt>$createdAt</dt>
                <dd>block {blocks(raw.createdAt)}</dd>
                <dt>$expiresAt</dt>
                <dd>block {blocks(raw.expiresAt)}</dd>
                <dt>flags</dt>
                <dd>
                  readonly {raw.creationFlags.readonly ? "yes" : "no"} · permissionlessExtension {raw.creationFlags.permissionlessExtension ? "yes" : "no"}
                </dd>
                <dt>payload</dt>
                <dd>
                  {raw.payload.length.toLocaleString("en-US").replace(/,/g, " ")} bytes · {raw.contentType}
                </dd>
              </dl>
              <p className={s.hexCap}>
                payload, first {Math.min(HEX_SHOWN, hex.length)} of {hex.length.toLocaleString("en-US").replace(/,/g, " ")} hex characters
              </p>
              <code className={`code ${s.hex}`}>
                {hex.slice(0, HEX_SHOWN)}
                {hex.length > HEX_SHOWN ? "…" : ""}
              </code>
            </>
          )}
        </div>
        <div className="panel">
          <span className="tag">not on the explorer</span>
          <ul className="hidden-list">
            {!out && <li>which vendor the case was sent to</li>}
            {!out && <li>the title, component and summary</li>}
            <li>the full report: ciphertext only, and its key is never released{out ? ", not even now" : ""}</li>
            <li>the proof of concept: only its hash is on Arkiv</li>
            <li>who the researcher is: a wallet, no name</li>
            {!out && <li>who the responder address belongs to</li>}
          </ul>
          <p className="note" style={{ marginTop: 16 }}>
            {out
              ? "Since the deadline, anyone can open the advisory and the vendor’s name from what was published on Arkiv. Everything above stays where it was."
              : "While the embargo runs, the public record shows that a case exists, how severe it is and when it ends."}
          </p>
        </div>
      </div>
    </section>
  );
}
