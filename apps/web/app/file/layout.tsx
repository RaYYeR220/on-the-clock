import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "File a report · On the Clock",
  description: "File a vulnerability report sealed to the vendor, with a deadline only you can move and an advisory that publishes itself.",
};

export default function FileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
