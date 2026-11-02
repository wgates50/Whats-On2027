"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { VenueLite } from "@/lib/data";
import type { VenueKind } from "@/lib/types";
import { usePrefs, useHydrated } from "@/lib/store";
import { venueRequestUrl } from "@/lib/site";
import { useAppData } from "@/lib/useData";
import { londonToday } from "@/lib/when";
import { Icon, LoadError, SectionHead } from "./ui";

const GROUPS: { id: string; label: string; kinds: VenueKind[] }[] = [
  { id: "all", label: "All", kinds: [] },
  { id: "museums", label: "Museums & galleries", kinds: ["museum", "public-gallery", "garden"] },
  { id: "commercial", label: "Commercial galleries", kinds: ["commercial-gallery"] },
  { id: "theatres", label: "Theatres", kinds: ["theatre"] },
  { id: "arts", label: "Arts centres", kinds: ["arts-centre"] },
  { id: "live", label: "Music, talks & comedy", kinds: ["concert-hall", "live-venue", "talks-venue", "comedy-club"] },
];

export const KIND_LABEL: Record<VenueKind, string> = {
  museum: "Museum",
  "public-gallery": "Gallery",
  "commercial-gallery": "Commercial gallery",
  "arts-centre": "Arts centre",
  theatre: "Theatre",
  "concert-hall": "Concert hall",
  "live-venue": "Live venue",
  "talks-venue": "Talks",
  "comedy-club": "Comedy",
  garden: "Garden",
};

export function PlacesView() {
  const { data, error } = useAppData();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    const today = londonToday();
    for (const e of data?.events ?? []) {
      const last = e.endDate ?? (e.ongoing ? "9999" : e.startDate ?? "9999");
      if (last >= today) c[e.venueId] = (c[e.venueId] ?? 0) + 1;
    }
    return c;
  }, [data]);
  if (error) return <LoadError message={error} />;
  if (!data)
    return (
      <header className="masthead" aria-busy="true">
        <p className="kicker">
          <span className="kicker__dot" /> Places
        </p>
        <h1 className="dateline skeleton">&nbsp;</h1>
      </header>
    );
  return <Places venues={data.venues} counts={counts} />;
}

function Places({ venues, counts }: { venues: VenueLite[]; counts: Record<string, number> }) {
  const hydrated = useHydrated();
  const { prefs, toggleFollow, set } = usePrefs();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [incoming, setIncoming] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // "Share my places" links: /places/?add=id1,id2
  useEffect(() => {
    const add = new URLSearchParams(location.search).get("add");
    if (add) setIncoming(add.split(",").filter((id) => venues.some((v) => v.id === id)));
  }, [venues]);

  const follows = useMemo(() => new Set(prefs.follows), [prefs.follows]);
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "");
  const kinds = GROUPS.find((g) => g.id === group)!.kinds;
  const list = venues.filter((v) => (!kinds.length || kinds.includes(v.kind)) && (!q || norm(`${v.name} ${v.area}`).includes(norm(q))));
  const followed = venues.filter((v) => follows.has(v.id));

  const shareLink = async () => {
    const url = `${location.origin}/places/?add=${prefs.follows.join(",")}`;
    try {
      if (navigator.share) await navigator.share({ title: "My places", url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* dismissed */
    }
  };

  const row = (v: VenueLite, i: number) => {
    const on = hydrated && follows.has(v.id);
    const n = counts[v.id] ?? 0;
    return (
      <li key={v.id} className="place" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
        <Link href={`/places/${v.id}/`} className="place__main">
          <span className="place__name">{v.name}</span>
          <span className="place__meta">
            {v.area} · {KIND_LABEL[v.kind]}
            {n > 0 ? ` · ${n} on` : v.coverage === "manual" ? " · manual" : v.coverage === "soon" ? " · coming soon" : ""}
          </span>
        </Link>
        <button className={`follow${on ? " is-on" : ""}`} onClick={() => toggleFollow(v.id)} aria-pressed={on} aria-label={on ? `Unfollow ${v.name}` : `Follow ${v.name}`}>
          {on ? Icon.check : Icon.plus}
          <span>{on ? "Following" : "Follow"}</span>
        </button>
      </li>
    );
  };

  return (
    <>
      <header className="masthead">
        <p className="kicker">
          <span className="kicker__dot" /> Places
        </p>
        <h1 className="dateline">
          <em>{venues.length}</em> places in London
        </h1>
      </header>

      {incoming.length > 0 && (
        <div className="banner">
          <p>Add {incoming.length} places from this link to your follows?</p>
          <button
            className="link-button"
            onClick={() => {
              set({ follows: [...new Set([...prefs.follows, ...incoming])] });
              setIncoming([]);
              history.replaceState(null, "", location.pathname);
            }}
          >
            Add them
          </button>
        </div>
      )}

      <label className="search">
        {Icon.search}
        <input type="search" placeholder="Search places or areas" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      <div className="chips" role="toolbar" aria-label="Kind of place">
        {GROUPS.map((g) => (
          <button key={g.id} className="chip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
            {g.label}
          </button>
        ))}
      </div>

      {hydrated && !q && group === "all" && followed.length > 0 && (
        <section className="section">
          <SectionHead
            title="Following"
            count={followed.length}
            action={
              <button className="link-button" onClick={shareLink}>
                {copied ? "Link copied" : "Share list"}
              </button>
            }
          />
          <ul className="places">{followed.map(row)}</ul>
        </section>
      )}

      <section className="section">
        <SectionHead title={q ? "Results" : GROUPS.find((g) => g.id === group)!.label} count={list.length} />
        <ul className="places">{list.map(row)}</ul>
        {list.length === 0 && <p className="empty">No places match “{q}”.</p>}
      </section>

      <p className="colophon">
        Missing somewhere? <a href={venueRequestUrl(q)}>Request a place</a> — it gets added automatically by the maintenance task.
      </p>
    </>
  );
}
