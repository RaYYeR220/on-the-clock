import { SEVERITY, type CaseStatus, type CaseView, type Severity, type TimelineItem } from "on-the-clock-sdk";

export const STATUS: Record<CaseStatus, { label: string; tone: "brass" | "ink" }> = {
  sealed: { label: "sealed", tone: "ink" },
  acknowledged: { label: "acknowledged", tone: "ink" },
  fixed: { label: "fixed", tone: "ink" },
  lapsed: { label: "lapsed", tone: "ink" },
  revealable: { label: "revealable", tone: "brass" },
  revealed: { label: "revealed", tone: "brass" },
  disclosed: { label: "disclosed", tone: "brass" },
  withdrawn: { label: "withdrawn", tone: "ink" },
};

export const STATUS_ORDER: CaseStatus[] = ["sealed", "acknowledged", "fixed", "lapsed", "revealable", "revealed", "disclosed", "withdrawn"];

/** The advisory is out, or can be rebuilt by anyone from published shares. */
export const isOut = (s: CaseStatus) => s === "revealable" || s === "revealed" || s === "disclosed";

export const sevLabel = (n: number) => SEVERITY[n as Severity] ?? `band ${n}`;

export const blocks = (b: bigint) => b.toLocaleString("en-US").replace(/,/g, " ");

/** A span of time in words, for asked and granted extensions. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const parts = [d && `${d}d`, h && `${h}h`, m && `${m}m`, r && !d && `${r}s`].filter(Boolean);
  return parts.length ? parts.slice(0, 2).join(" ") : "0s";
}

export function kindWords(t: TimelineItem): string {
  switch (t.kind) {
    case "case":
      return "Filed and sealed";
    case "ack":
      return "Acknowledged";
    case "extreq":
      return t.seconds ? `Asked for ${duration(t.seconds)} more` : "Asked for more time";
    case "grant":
      return t.seconds ? `Granted ${duration(t.seconds)} more` : "Granted more time";
    case "handoff":
      return "Handed the clock off";
    case "fixed":
      return "Marked fixed";
    case "receipt":
      return t.outcome ? `Receipt: ${t.outcome}` : "Receipt";
    case "reveal":
      return "Reveal: advisory key published";
    default:
      return t.kind;
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Who an address is to this case, from the case file and its verified handoffs. */
export function roleOf(view: CaseView, a: string): string {
  if (same(a, view.researcher)) return "researcher";
  if (same(a, view.responder)) return "responder";
  const w = view.watchers.findIndex((x) => same(x, a));
  if (w >= 0) return `watcher ${w + 1}`;
  if (view.timeline.some((t) => t.kind === "handoff" && t.verdict === "verified" && t.to && same(t.to, a))) return "coordinator";
  return "unknown address";
}
