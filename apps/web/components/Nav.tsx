"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "./Mark";
import { useHead } from "@/lib/hooks";

const LINKS = [
  { href: "/demo", label: "Watch one run" },
  { href: "/board", label: "Board" },
  { href: "/file", label: "File a report" },
  { href: "/inbox", label: "Vendor inbox" },
  { href: "/watchers", label: "Watchers" },
  { href: "/how", label: "How it works" },
];

export function Nav() {
  const path = usePathname();
  const { head } = useHead();
  return (
    <header className="nav">
      <Link className="mark" href="/">
        <Mark />
        On the Clock
      </Link>
      <ul>
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} aria-current={path?.startsWith(l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="row" style={{ gap: 10 }}>
        <span className="blk mono" title="Tiramisu testnet head, pushed over a WebSocket subscription">
          <i className={`lamp ${head ? "blink-a" : "off"}`} />
          block <b>{head ? head.toLocaleString("en-US").replace(/,/g, " ") : "…"}</b>
        </span>
        <details className="menu">
          <summary aria-label="Menu">
            <span />
            <span />
          </summary>
          <nav>
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
