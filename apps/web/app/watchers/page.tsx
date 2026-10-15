import type { Metadata } from "next";
import { WatcherNetwork } from "@/components/WatcherNetwork";

export const metadata: Metadata = {
  title: "Watchers · On the Clock",
  description: "Every watcher alive on Tiramisu right now, read from its Arkiv lease, and how to run your own.",
};

export default function WatchersPage() {
  return <WatcherNetwork />;
}
