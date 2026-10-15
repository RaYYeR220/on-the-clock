import s from "./CaseStamp.module.css";

/** The global `.stamp`, with a worn-ink texture that stays legible on the dark ground. */
export function CaseStamp({ tone, size, thunk = false, children }: { tone: "rust" | "brass" | "ink"; size?: "small" | "large"; thunk?: boolean; children: React.ReactNode }) {
  return <span className={["stamp", tone, s.inked, size ? s[size] : "", thunk ? "thunk" : ""].filter(Boolean).join(" ")}>{children}</span>;
}
