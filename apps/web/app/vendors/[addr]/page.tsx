import type { Metadata } from "next";
import { VendorScorecard } from "@/components/VendorScorecard";

type Props = { params: Promise<{ addr: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { addr } = await params;
  return {
    title: `Vendor ${addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr} · On the Clock`,
    description: "A vendor's record, counted only from disclosure cases that are already public and verified on Arkiv.",
  };
}

export default async function VendorPage({ params }: Props) {
  const { addr } = await params;
  return <VendorScorecard addr={addr} />;
}
