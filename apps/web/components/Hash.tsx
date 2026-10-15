"use client";
import { useState } from "react";
import { addressUrl, entityUrl, txUrl } from "@/lib/arkiv";

export const short = (v: string, head = 6, tail = 4) => (v.length > head + tail + 2 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v);

/** A hash, address or entity key: shortened, linked to the explorer, copyable. */
export function Hash({ value, kind = "entity", full = false }: { value: string; kind?: "entity" | "tx" | "address"; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const href = kind === "tx" ? txUrl(value) : kind === "address" ? addressUrl(value) : entityUrl(value);
  return (
    <span className="mono" style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
      <a className="ext" href={href} target="_blank" rel="noreferrer" title={value}>
        {full ? value : short(value)}
      </a>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        title="Copy"
        style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--muted)", fontSize: 11 }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}
