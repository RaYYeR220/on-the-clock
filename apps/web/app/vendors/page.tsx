import type { Metadata } from "next";
import { VendorIndex } from "@/components/VendorIndex";

export const metadata: Metadata = {
  title: "Vendors · On the Clock",
  description: "Vendor disclosure inboxes on Arkiv, each with a scorecard built only from cases that are already public.",
};

export default function VendorsPage() {
  return <VendorIndex />;
}
