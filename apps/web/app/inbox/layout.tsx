import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vendor inbox · On the Clock",
  description: "The vendor console: open an inbox, find the cases addressed to you by trial-decryption, and answer them from one-time addresses.",
};

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return children;
}
