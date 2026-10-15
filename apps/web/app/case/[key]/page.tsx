"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Hex } from "viem";
import { short } from "@/components/Hash";
import { useCase, useHead } from "@/lib/hooks";
import { CaseFile } from "./CaseFile";
import s from "./case.module.css";

const KEY = /^0x[0-9a-fA-F]{64}$/;
const NOT_FOUND = "No On the Clock case";

export default function CasePage() {
  const params = useParams<{ key: string }>();
  const raw = decodeURIComponent(String(params?.key ?? ""));
  if (!KEY.test(raw)) {
    return (
      <Missing title="That is not an entity key.">
        Case keys are 32-byte hex strings: <span className="mono">0x</span> followed by 64 hex characters. Open a case from the board to get one.
      </Missing>
    );
  }
  return <CaseLoader caseKey={raw.toLowerCase() as Hex} />;
}

function CaseLoader({ caseKey }: { caseKey: Hex }) {
  const { bundle, reveal, error, loading, reload } = useCase(caseKey);
  const { head, at } = useHead();

  if (bundle) return <CaseFile bundle={bundle} reveal={reveal} head={head} at={at} refreshError={error} />;
  if (loading) {
    return (
      <main className="page">
        <p className="eyebrow">
          <i />
          Case file
        </p>
        <p className={`${s.loading} mono`} role="status">
          <i className="lamp blink-a" />
          reading case {short(caseKey)} and everything that points at it from Arkiv…
        </p>
      </main>
    );
  }
  if (error?.startsWith(NOT_FOUND)) {
    return (
      <Missing title="No case with this key.">
        Arkiv has no On the Clock case file at <span className="mono">{short(caseKey, 10, 8)}</span> on Tiramisu. The key may be mistyped, or
        it may belong to another kind of entity: a clock, a receipt or an inbox is not a case file.
      </Missing>
    );
  }
  return (
    <Missing title="Could not read this case.">
      The Tiramisu RPC did not answer: {(error ?? "unknown error").replace(/\.$/, "")}.{" "}
      <button type="button" className="btn ghost small" onClick={() => void reload()} style={{ marginLeft: 6 }}>
        Try again
      </button>
    </Missing>
  );
}

function Missing({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="page">
      <p className="eyebrow">
        <i />
        Case file
      </p>
      <h1 className="h-page" style={{ marginTop: 14 }}>
        {title}
      </h1>
      <p className="lede">{children}</p>
      <div className="row" style={{ gap: 22, marginTop: 28 }}>
        <Link className="btn" href="/board">
          See the live board
        </Link>
        <Link className="link" href="/demo">
          Watch a deadline run
        </Link>
      </div>
    </main>
  );
}
