import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VenueView } from "@/components/VenueView";
import { loadAppData } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return loadAppData().venues.map((v) => ({ id: v.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const v = loadAppData().venues.find((x) => x.id === id);
  return { title: v?.name ?? "Place" };
}

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { venues, events } = loadAppData();
  const venue = venues.find((v) => v.id === id);
  if (!venue) notFound();
  const baseline = events.reduce((m, e) => (e.firstSeen < m ? e.firstSeen : m), "9999");
  return <VenueView venue={venue} events={events.filter((e) => e.venueId === id)} baseline={baseline} />;
}
