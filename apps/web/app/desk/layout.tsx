import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Researcher desk · On the Clock",
  description: "The researcher console: every case this browser filed, its clock, the vendor's answers, and the moves only the custodian can make.",
};

export default function DeskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
