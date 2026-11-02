import type { Metadata } from "next";
import { FeedView } from "@/components/FeedView";

export const metadata: Metadata = { title: "Feed" };

export default function FeedPage() {
  return <FeedView />;
}
