"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAppData } from "@/lib/useData";

/** Theme ids → their labels (from the app's data). */
export function useThemeLabels(): Map<string, string> {
  const { data } = useAppData();
  return useMemo(() => new Map((data?.themes ?? []).map((t) => [t.id, t.label])), [data]);
}

/** Something's themes, each a link to Discover's page for that theme. */
export function ThemeChips({ ids }: { ids?: string[] }) {
  const labels = useThemeLabels();
  const known = (ids ?? []).filter((id) => labels.has(id));
  if (!known.length) return null;
  return (
    <p className="themes">
      {known.map((id) => (
        <Link key={id} href={`/discover/?theme=${id}`} className="theme-chip">
          {labels.get(id)}
        </Link>
      ))}
    </p>
  );
}
