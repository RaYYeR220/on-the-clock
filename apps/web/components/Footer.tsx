import Link from "next/link";

export function Footer() {
  return (
    <footer className="footer">
      <span>On the Clock · built on Arkiv, Tiramisu testnet (chain 7738577) · all demo data is synthetic</span>
      <span className="row" style={{ gap: 22 }}>
        <Link href="/how">How it works</Link>
        <Link href="/watchers">Watchers</Link>
        <a href="https://github.com/RaYYeR220/on-the-clock" target="_blank" rel="noreferrer">Source (MIT)</a>
        <a href="https://tiramisu.explorer.arkiv.network" target="_blank" rel="noreferrer">Explorer</a>
      </span>
    </footer>
  );
}
