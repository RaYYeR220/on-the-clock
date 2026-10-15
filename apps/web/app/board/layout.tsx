import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Board · On the Clock",
  description: "Every disclosure case on Arkiv, its deadline and its state, rebuilt in your browser from one query.",
};

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
