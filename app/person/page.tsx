import type { Metadata } from "next";
import { PersonView } from "@/components/PersonView";

export const metadata: Metadata = { title: "Person" };

// One static page for everyone (/person/?id=…): ~2,000 performers don't each need a page.
export default function PersonPage() {
  return <PersonView />;
}
