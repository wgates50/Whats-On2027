import type { Metadata } from "next";
import { Suspense } from "react";
import { DiscoverSkeleton, DiscoverView } from "@/components/DiscoverView";

export const metadata: Metadata = { title: "Discover" };

// One static page: /discover/ (picked for you) and /discover/?theme=… (one theme).
export default function DiscoverPage() {
  return (
    <Suspense fallback={<DiscoverSkeleton />}>
      <DiscoverView />
    </Suspense>
  );
}
