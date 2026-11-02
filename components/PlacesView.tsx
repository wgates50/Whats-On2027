"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { VenueLite } from "@/lib/data";
import type { Person, PersonKind, VenueKind, WOEvent } from "@/lib/types";
import { usePrefs, useHydrated } from "@/lib/store";
import { venueRequestUrl } from "@/lib/site";
import { useAppData, usePeopleData } from "@/lib/useData";
import { londonToday, shortDate } from "@/lib/when";
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

export const PERSON_KIND_LABEL: Record<PersonKind, string> = {
  music: "Music",
  comedy: "Comedy",
  theatre: "Theatre",
  dance: "Dance",
  family: "Family",
  talk: "Talks",
  other: "Live",
};

const PEOPLE_GROUPS: { id: string; label: string; kinds: PersonKind[] }[] = [
  { id: "all", label: "All", kinds: [] },
  { id: "comedy", label: "Comedy", kinds: ["comedy"] },
  { id: "music", label: "Music", kinds: ["music"] },
  { id: "theatre", label: "Theatre & dance", kinds: ["theatre", "dance"] },
  { id: "talk", label: "Talks", kinds: ["talk"] },
  { id: "family", label: "Family", kinds: ["family"] },
];

const lastDay = (e: WOEvent) => e.endDate ?? (e.ongoing ? "9999" : e.startDate ?? "9999");
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "");

export function PlacesView() {
  const { data, error } = useAppData();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    const today = londonToday();
    for (const e of data?.events ?? []) if (lastDay(e) >= today) c[e.venueId] = (c[e.venueId] ?? 0) + 1;
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
  return <Places venues={data.venues} counts={counts} events={data.events} />;
}

function Places({ venues, counts, events }: { venues: VenueLite[]; counts: Record<string, number>; events: WOEvent[] }) {
  const hydrated = useHydrated();
  const { prefs, toggleFollow, set } = usePrefs();
  const [show, setShow] = useState<"places" | "people">("places");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [incoming, setIncoming] = useState<{ places: string[]; people: string[] }>({ places: [], people: [] });
  const [copied, setCopied] = useState(false);

  // ?show=people, and "Share list" links: /places/?add=venue1,venue2&people=person1,person2
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("show") === "people") setShow("people");
    const places = (p.get("add") ?? "").split(",").filter((id) => venues.some((v) => v.id === id));
    const people = (p.get("people") ?? "").split(",").filter((id) => /^[a-z0-9-]+$/.test(id));
    if (places.length || people.length) setIncoming({ places, people });
  }, [venues]);

  const switchTo = (next: "places" | "people") => {
    setShow(next);
    setQ("");
    history.replaceState(null, "", next === "people" ? "?show=people" : location.pathname);
  };

  const follows = useMemo(() => new Set(prefs.follows), [prefs.follows]);
  const kinds = GROUPS.find((g) => g.id === group)!.kinds;
  const list = venues.filter((v) => (!kinds.length || kinds.includes(v.kind)) && (!q || norm(`${v.name} ${v.area}`).includes(norm(q))));
  const followed = venues.filter((v) => follows.has(v.id));

  const shareLink = async () => {
    const qs = [prefs.follows.length ? `add=${prefs.follows.join(",")}` : "", prefs.people.length ? `people=${prefs.people.join(",")}` : ""].filter(Boolean).join("&");
    const url = `${location.origin}/places/?${qs}`;
    try {
      if (navigator.share) await navigator.share({ title: "What I follow", url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* dismissed */
    }
  };
  const share = (
    <button className="link-button" onClick={shareLink}>
      {copied ? "Link copied" : "Share list"}
    </button>
  );

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

  const incomingCount = incoming.places.length + incoming.people.length;

  return (
    <>
      <header className="masthead">
        <p className="kicker">
          <span className="kicker__dot" /> {show === "people" ? "People" : "Places"}
        </p>
        <h1 className="dateline">{show === "people" ? <><em>Who’s on</em> in London</> : <><em>{venues.length}</em> places in London</>}</h1>
      </header>

      <div className="switch" role="tablist" aria-label="Places or people">
        <button role="tab" aria-selected={show === "places"} onClick={() => switchTo("places")}>
          Places
        </button>
        <button role="tab" aria-selected={show === "people"} onClick={() => switchTo("people")}>
          People
        </button>
      </div>

      {incomingCount > 0 && (
        <div className="banner">
          <p>
            Follow{" "}
            {[incoming.places.length && `${incoming.places.length} places`, incoming.people.length && `${incoming.people.length} people`].filter(Boolean).join(" and ")}{" "}
            from this link?
          </p>
          <button
            className="link-button"
            onClick={() => {
              set({ follows: [...new Set([...prefs.follows, ...incoming.places])], people: [...new Set([...prefs.people, ...incoming.people])] });
              setIncoming({ places: [], people: [] });
              history.replaceState(null, "", show === "people" ? "?show=people" : location.pathname);
            }}
          >
            Follow them
          </button>
        </div>
      )}

      <label className="search">
        {Icon.search}
        <input type="search" placeholder={show === "people" ? "Search comedians, bands, shows…" : "Search places or areas"} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      {show === "people" ? (
        <PeopleList q={q} events={events} share={share} />
      ) : (
        <>
          <div className="chips" role="toolbar" aria-label="Kind of place">
            {GROUPS.map((g) => (
              <button key={g.id} className="chip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
                {g.label}
              </button>
            ))}
          </div>

          {hydrated && !q && group === "all" && followed.length > 0 && (
            <section className="section">
              <SectionHead title="Following" count={followed.length} action={share} />
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
      )}
    </>
  );
}

/** Performers with London dates, from ticketing listings (Ticketmaster, Skiddle). */
function PeopleList({ q, events, share }: { q: string; events: WOEvent[]; share: React.ReactNode }) {
  const hydrated = useHydrated();
  const { prefs, togglePerson } = usePrefs();
  const { people, error } = usePeopleData(true);
  const [group, setGroup] = useState("all");
  const [today, setToday] = useState("");
  const [all, setAll] = useState(false);
  useEffect(() => setToday(londonToday()), []);

  const dates = useMemo(() => {
    const m = new Map<string, WOEvent[]>();
    if (!people || !today) return m;
    for (const e of [...events, ...people.elsewhere]) {
      if (lastDay(e) < today) continue;
      for (const id of e.people ?? []) m.set(id, [...(m.get(id) ?? []), e]);
    }
    for (const list of m.values()) list.sort((a, b) => (a.startDate ?? today).localeCompare(b.startDate ?? today));
    return m;
  }, [events, people, today]);

  if (error) return <LoadError message={error} />;
  if (!people || !today) return <p className="empty">Finding who’s on…</p>;

  const followedIds = new Set(prefs.people);
  const kinds = PEOPLE_GROUPS.find((g) => g.id === group)!.kinds;
  const on = people.people.filter((p) => dates.has(p.id));
  const matches = on
    .filter((p) => (!kinds.length || kinds.includes(p.kind)) && (!q || norm(p.name).includes(norm(q))))
    .sort((a, b) => (q ? a.name.localeCompare(b.name) : (dates.get(b.id)?.length ?? 0) - (dates.get(a.id)?.length ?? 0) || a.name.localeCompare(b.name)));
  const cap = q || all ? 200 : 40;
  const followed = people.people.filter((p) => followedIds.has(p.id));

  const row = (p: Person, i: number) => {
    const ds = dates.get(p.id) ?? [];
    const next = ds[0];
    const isOn = hydrated && followedIds.has(p.id);
    const nextText = next ? `next ${shortDate(next.startDate && next.startDate > today ? next.startDate : today)}` : "no dates right now";
    return (
      <li key={p.id} className="place" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
        <Link href={`/person/?id=${encodeURIComponent(p.id)}`} className="place__main">
          <span className="place__name">{p.name}</span>
          <span className="place__meta">
            {PERSON_KIND_LABEL[p.kind]} · {ds.length ? `${ds.length} ${ds.length === 1 ? "date" : "dates"} · ${nextText}` : nextText}
          </span>
        </Link>
        <button className={`follow${isOn ? " is-on" : ""}`} onClick={() => togglePerson(p.id)} aria-pressed={isOn} aria-label={isOn ? `Unfollow ${p.name}` : `Follow ${p.name}`}>
          {isOn ? Icon.check : Icon.plus}
          <span>{isOn ? "Following" : "Follow"}</span>
        </button>
      </li>
    );
  };

  return (
    <>
      <div className="chips" role="toolbar" aria-label="Kind of act">
        {PEOPLE_GROUPS.map((g) => (
          <button key={g.id} className="chip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
            {g.label}
          </button>
        ))}
      </div>

      {hydrated && !q && group === "all" && followed.length > 0 && (
        <section className="section">
          <SectionHead title="Following" count={followed.length} action={share} />
          <ul className="places">{followed.map(row)}</ul>
        </section>
      )}

      <section className="section">
        <SectionHead title={q ? "Results" : "Most London dates"} count={matches.length} />
        <ul className="places">{matches.slice(0, cap).map(row)}</ul>
        {matches.length === 0 && <p className="empty">{q ? `No one on in London matches “${q}”.` : "No one listed right now."}</p>}
        {!q && matches.length > cap && (
          <button className="more" onClick={() => setAll(true)}>
            Show more
          </button>
        )}
      </section>

      <p className="colophon">
        Performers come from Ticketmaster and Skiddle listings. Follow someone and their London dates — at any venue — appear in your calendar and feed.
      </p>
    </>
  );
}
