import type { Metadata } from "next";
import { PlacesView } from "@/components/PlacesView";

export const metadata: Metadata = { title: "Places" };

export default function PlacesPage() {
  return <PlacesView />;
}
