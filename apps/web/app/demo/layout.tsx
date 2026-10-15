import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Watch one run · On the Clock",
  description: "A guided, live run of a self-enforcing disclosure deadline on Arkiv: real transactions on Tiramisu, two throwaway wallets, no setup.",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
