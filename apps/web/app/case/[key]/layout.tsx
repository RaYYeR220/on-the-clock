import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  const label = /^0x[0-9a-fA-F]{64}$/.test(key) ? `${key.slice(0, 6)}…${key.slice(-4)}` : "not found";
  return {
    title: `Case ${label} · On the Clock`,
    description: "One disclosure case as Arkiv records it: its deadline, every act on it with its verdict, and what the public can and cannot see.",
  };
}

export default function CaseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
