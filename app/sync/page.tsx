import type { Metadata } from "next";
import { SyncView } from "@/components/SyncView";

export const metadata: Metadata = { title: "Sync" };

export default function SyncPage() {
  return <SyncView />;
}
