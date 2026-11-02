"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AppData } from "@/lib/data";
import type { WOEvent } from "@/lib/types";
import { usePrefs, useHydrated } from "@/lib/store";
import { addDays, daysBetween, isOnDay, isOneOff, londonToday, notOnSaleYet, shortDate } from "@/lib/when";
import { useAppData, usePeopleData } from "@/lib/useData";
import { EventRow } from "./EventRow";
import { Empty, LoadError, SectionHead } from "./ui";

export function FeedView() {
  const { data, error } = useAppData();
  if (error) return <LoadError message={error} />;
  if (!data) return <FeedSkeleton />;
  return <Feed data={data} />;
}

function FeedSkeleton() {
  return (
    <header className="masthead" aria-busy="true">
      <p className="kicker">
        <span className="kicker__dot" /> Feed
      </p>
      <h1 className="dateline skeleton">&nbsp;</h1>
    </header>
  );
}

/** Listing services (not venues) that some events come from — credited in the footer. */
const CREDITS: [sourceId: string, name: string][] = [
  ["official-london-theatre", "Official London Theatre"],
  ["art-fund", "Art Fund"],
  ["ticketmaster", "Ticketmaster"],
  ["skiddle", "Skiddle"],
];

function Feed({ data }: { data: AppData }) {
  const hydrated = useHydrated();
  const { prefs, toggleSaved } = usePrefs();
  const [today, setToday] = useState("");
  useEffect(() => setToday(londonToday()), []);

  const venues = useMemo(() => new Map(data.venues.map((v) => [v.id, v])), [data.venues]);
  const baseline = useMemo(() => data.events.reduce((m, e) => (e.firstSeen < m ? e.firstSeen : m), "9999"), [data.events]);
  const follows = useMemo(() => new Set(prefs.follows), [prefs.follows]);
  const followedPeople = useMemo(() => new Set(prefs.people), [prefs.people]);
  const saved = useMemo(() => new Set(prefs.saved), [prefs.saved]);
  const credits = useMemo(() => CREDITS.filter(([id]) => data.events.some((e) => e.sourceId === id)).map(([, name]) => name), [data.events]);
  const { people } = usePeopleData(followedPeople.size > 0);

  if (!hydrated || !today) return <FeedSkeleton />;

  const anyFollows = follows.size + followedPeople.size > 0;
  const byPerson = (e: WOEvent) => !!e.people?.some((p) => followedPeople.has(p));
  const isMine = (e: WOEvent) => follows.has(e.venueId) || byPerson(e);
  const scope = (e: WOEvent) => !anyFollows || isMine(e);
  const lastDay = (e: WOEvent) => e.endDate ?? (e.ongoing ? "9999" : e.startDate ?? "9999");
  // Dates of people you follow at venues we don't list count as yours too.
  const elsewhere = (people?.elsewhere ?? []).filter(byPerson);
  const upcoming = [...data.events, ...elsewhere].filter((e) => lastDay(e) >= today);
  const now = new Date().toISOString();
  const nextMonth = new Date(Date.now() + 31 * 864e5).toISOString();

  const plans = upcoming
    .filter((e) => saved.has(e.id))
    .sort((a, b) => (a.startDate && a.startDate > today ? a.startDate : today).localeCompare(b.startDate && b.startDate > today ? b.startDate : today));

  const announced = upcoming
    .filter((e) => scope(e) && e.firstSeen > baseline && daysBetween(e.firstSeen, today) <= 14)
    .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));

  // Tickets going on general sale soon (Ticketmaster), soonest first.
  const onSale = upcoming
    .filter((e) => scope(e) && notOnSaleYet(e, now) && e.onSale!.start <= nextMonth)
    .sort((a, b) => a.onSale!.start.localeCompare(b.onSale!.start));

  // Everything coming up for the people you follow, wherever it is.
  const theirs = upcoming.filter(byPerson).sort((a, b) => (a.startDate ?? today).localeCompare(b.startDate ?? today) || a.title.localeCompare(b.title));

  const weekEnd = addDays(today, 7);
  const opening = upcoming
    .filter((e) => scope(e) && !isOneOff(e) && e.startDate && e.startDate >= today && e.startDate <= weekEnd)
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!));

  const closing = upcoming
    .filter((e) => scope(e) && !isOneOff(e) && e.endDate && e.endDate >= today && e.endDate <= addDays(today, 10) && e.startDate !== e.endDate)
    .sort((a, b) => a.endDate!.localeCompare(b.endDate!));

  // The coming weekend (or this one, if it's already Saturday/Sunday).
  const dow = new Date(today + "T12:00:00Z").getUTCDay();
  const sat = dow === 0 ? addDays(today, -1) : addDays(today, (6 - dow + 7) % 7);
  const sun = addDays(sat, 1);
  const weekend = upcoming
    .filter((e) => scope(e) && isOneOff(e) && ((sat >= today && isOnDay(e, sat, today)) || isOnDay(e, sun, today)))
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || (a.startTime ?? "99").localeCompare(b.startTime ?? "99"));

  const row = (e: WOEvent, i: number, day = today) => (
    <EventRow
      key={e.id}
      e={e}
      venue={venues.get(e.venueId)}
      day={day}
      today={today}
      baseline={baseline}
      followed={isMine(e)}
      saved={saved.has(e.id)}
      onToggleSaved={() => toggleSaved(e.id)}
      index={i}
      dated
    />
  );
  const cap = anyFollows ? 40 : 12;

  return (
    <>
      <header className="masthead">
        <p className="kicker">
          <span className="kicker__dot" /> Feed
        </p>
        <h1 className="dateline">
          <em>What’s new</em> {anyFollows ? "for you" : "in London"}
        </h1>
      </header>

      {!anyFollows && (
        <p className="nudge">
          You’re not following anything yet, so this is a taste of all of London. <Link href="/places/">Choose your places</Link> or{" "}
          <Link href="/places/?show=people">people</Link> and the feed narrows to them.
        </p>
      )}

      {plans.length > 0 && (
        <section className="section">
          <SectionHead title="Your plans" count={plans.length} />
          <div className="rows">{plans.map((e, i) => row(e, i, e.startDate && e.startDate > today ? e.startDate : today))}</div>
        </section>
      )}

      {onSale.length > 0 && (
        <section className="section">
          <SectionHead title="On sale soon" count={onSale.length} />
          <div className="rows">{onSale.slice(0, cap).map((e, i) => row(e, i, e.startDate && e.startDate > today ? e.startDate : today))}</div>
        </section>
      )}

      {followedPeople.size > 0 && (
        <section className="section">
          <SectionHead title="People you follow" count={theirs.length} />
          {theirs.length ? (
            <div className="rows">{theirs.slice(0, cap).map((e, i) => row(e, i, e.startDate && e.startDate > today ? e.startDate : today))}</div>
          ) : (
            <Empty>
              <p>No London dates for the people you follow right now. New ones appear here as soon as they’re announced.</p>
            </Empty>
          )}
        </section>
      )}

      <section className="section">
        <SectionHead title="Just announced" count={announced.length} />
        {announced.length ? (
          <div className="rows">{announced.slice(0, cap).map((e, i) => row(e, i))}</div>
        ) : (
          <Empty>
            <p>Nothing new {anyFollows ? "for what you follow" : ""} in the last two weeks. New listings appear here the day they’re published.</p>
          </Empty>
        )}
      </section>

      {weekend.length > 0 && (
        <section className="section">
          <SectionHead title={`This weekend · ${shortDate(sat)}–${shortDate(sun)}`} count={weekend.length} />
          <div className="rows">{weekend.slice(0, cap).map((e, i) => row(e, i, e.startDate ?? sat))}</div>
        </section>
      )}

      {opening.length > 0 && (
        <section className="section">
          <SectionHead title="Opening this week" count={opening.length} />
          <div className="rows">{opening.slice(0, cap).map((e, i) => row(e, i, e.startDate!))}</div>
        </section>
      )}

      {closing.length > 0 && (
        <section className="section">
          <SectionHead title="Last chance" count={closing.length} />
          <div className="rows">{closing.slice(0, cap).map((e, i) => row(e, i))}</div>
        </section>
      )}

      <p className="colophon">
        Updated {data.generatedAt ? shortDate(data.generatedAt.slice(0, 10), true) : "—"} · listings from each venue’s own site
        {credits.length > 0 && `, plus ${credits.join(", ").replace(/, ([^,]*)$/, " and $1")}`}.
      </p>
    </>
  );
}
