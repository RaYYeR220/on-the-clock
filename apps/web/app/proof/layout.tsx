import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Proof · On the Clock",
  description: "One case on Tiramisu from filing to self-publication, with every refusal and forgery on record and linked to the explorer.",
};

export default function ProofLayout({ children }: { children: React.ReactNode }) {
  return children;
}
