"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { WOEvent } from "@/lib/types";
import { usePrefs, useHydrated } from "@/lib/store";
import { useAppData, usePeopleData } from "@/lib/useData";
import { londonToday } from "@/lib/when";
import { EventRow } from "./EventRow";
import { PERSON_KIND_LABEL } from "./PlacesView";
import { Empty, Icon, LoadError, SectionHead } from "./ui";

const LINK_LABEL: Record<string, string> = { homepage: "Website", spotify: "Spotify", instagram: "Instagram", wiki: "Wikipedia", youtube: "YouTube" };

export function PersonView() {
  const hydrated = useHydrated();
  const { data, error } = useAppData();
  const { people, error: peopleError } = usePeopleData(true);
  const { prefs, togglePerson, toggleSaved } = usePrefs();
  const [id, setId] = useState<string | null>(null);
  const [today, setToday] = useState("");
  useEffect(() => {
    setId(new URLSearchParams(location.search).get("id"));
    setToday(londonToday());
  }, []);

  const person = useMemo(() => people?.people.find((p) => p.id === id), [people, id]);
  const venues = useMemo(() => new Map((data?.venues ?? []).map((v) => [v.id, v])), [data]);

  useEffect(() => {
    if (person) document.title = `${person.name} · ${document.title.split(" · ").slice(-1)[0]}`;
  }, [person]);

  if (error || peopleError) return <LoadError message={(error ?? peopleError)!} />;
  if (!data || !people || !id || !today || !hydrated)
    return (
      <header className="masthead" aria-busy="true">
        <p className="kicker">
          <Link href="/places/?show=people">← People</Link>
        </p>
        <h1 className="venue-name skeleton">&nbsp;</h1>
      </header>
    );

  if (!person)
    return (
      <>
        <header className="masthead masthead--venue">
          <p className="kicker">
            <Link href="/places/?show=people">← People</Link>
          </p>
          <h1 className="venue-name">Not on right now</h1>
        </header>
        <Empty>
          <p>No London dates are listed for this act at the moment. If you follow them, new dates will still show up in your feed.</p>
        </Empty>
      </>
    );

  const on = prefs.people.includes(person.id);
  const saved = new Set(prefs.saved);
  const lastDay = (e: WOEvent) => e.endDate ?? (e.ongoing ? "9999" : e.startDate ?? "9999");
  const dates = [...data.events, ...people.elsewhere]
    .filter((e) => e.people?.includes(person.id) && lastDay(e) >= today)
    .sort((a, b) => (a.startDate ?? today).localeCompare(b.startDate ?? today) || a.title.localeCompare(b.title));
  const baseline = data.events.reduce((m, e) => (e.firstSeen < m ? e.firstSeen : m), "9999");
  const links = Object.entries(person.links ?? {}).filter(([, url]) => url);

  return (
    <>
      <header className="masthead masthead--venue">
        <p className="kicker">
          <Link href="/places/?show=people">← People</Link>
        </p>
        <h1 className="venue-name">{person.name}</h1>
        <p className="venue-meta">
          {PERSON_KIND_LABEL[person.kind]}
          {links.map(([k, url]) => (
            <span key={k}>
              {" · "}
              <a href={url} target="_blank" rel="noopener noreferrer">
                {LINK_LABEL[k] ?? k} {Icon.arrow}
              </a>
            </span>
          ))}
        </p>
        <button className={`follow follow--big${on ? " is-on" : ""}`} onClick={() => togglePerson(person.id)} aria-pressed={on}>
          {on ? Icon.check : Icon.plus}
          <span>{on ? "Following" : "Follow"}</span>
        </button>
      </header>

      <section className="section">
        <SectionHead title="London dates" count={dates.length} />
        {dates.length ? (
          <div className="rows">
            {dates.map((e, i) => (
              <EventRow
                key={e.id}
                e={e}
                venue={venues.get(e.venueId)}
                day={e.startDate && e.startDate > today ? e.startDate : today}
                today={today}
                baseline={baseline}
                followed={prefs.follows.includes(e.venueId)}
                saved={saved.has(e.id)}
                onToggleSaved={() => toggleSaved(e.id)}
                index={i}
                dated
              />
            ))}
          </div>
        ) : (
          <Empty>
            <p>No London dates listed right now.</p>
          </Empty>
        )}
      </section>

      <p className="colophon">
        {on ? "You’ll see their new London dates in your feed and calendar, wherever they play." : "Follow to see their new London dates in your feed and calendar, wherever they play."} Listings from
        Ticketmaster and Skiddle.
      </p>
    </>
  );
}
