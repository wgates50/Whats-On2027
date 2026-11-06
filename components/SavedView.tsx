"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { WOEvent } from "@/lib/types";
import { laterDay, usePrefs, useHydrated } from "@/lib/store";
import { useAppData, usePeopleData } from "@/lib/useData";
import { addDays, isOnDay, isOneOff, londonToday } from "@/lib/when";
import { EventRow } from "./EventRow";
import { Empty, Icon, LoadError, SectionHead } from "./ui";

/** Everything you've starred, soonest first. */
export function SavedView() {
  const hydrated = useHydrated();
  const { data, error } = useAppData();
  const { prefs, toggleSaved, set } = usePrefs();
  // Saved dates at venues we don't list live in people.json (ids start with "~").
  const { people } = usePeopleData(prefs.saved.some((id) => id.startsWith("~")));
  const [today, setToday] = useState("");
  useEffect(() => setToday(londonToday()), []);

  const venues = useMemo(() => new Map((data?.venues ?? []).map((v) => [v.id, v])), [data]);
  const byId = useMemo(() => new Map([...(data?.events ?? []), ...(people?.elsewhere ?? [])].map((e) => [e.id, e])), [data, people]);

  if (error) return <LoadError message={error} />;
  if (!data || !hydrated || !today)
    return (
      <header className="masthead" aria-busy="true">
        <p className="kicker">
          <span className="kicker__dot" /> Saved
        </p>
        <h1 className="dateline skeleton">&nbsp;</h1>
      </header>
    );

  const lastDay = (e: WOEvent) => e.endDate ?? (e.ongoing ? "9999" : e.startDate ?? "9999");
  const nextDay = (e: WOEvent) => (e.startDate && e.startDate > today ? e.startDate : today);
  const saved = prefs.saved.map((id) => byId.get(id)).filter((e): e is WOEvent => !!e);
  const upcoming = saved.filter((e) => lastDay(e) >= today).sort((a, b) => nextDay(a).localeCompare(nextDay(b)) || (a.startTime ?? "99").localeCompare(b.startTime ?? "99"));
  const weekEnd = addDays(today, 7);
  const thisWeek = upcoming.filter((e) => nextDay(e) <= weekEnd);
  const later = upcoming.filter((e) => nextDay(e) > weekEnd);
  const onToday = upcoming.filter((e) => isOnDay(e, today, today) && isOneOff(e)).length;
  // Finished, or gone from the listings (we only keep current events): nothing to show but a tidy-up.
  const peopleLoading = prefs.saved.some((id) => id.startsWith("~")) && !people;
  const gone = peopleLoading ? [] : prefs.saved.filter((id) => !byId.has(id) || lastDay(byId.get(id)!) < today);
  const baseline = laterDay(
    data.events.reduce((m, e) => (e.firstSeen < m ? e.firstSeen : m), "9999"),
    prefs.seenUpTo,
  );

  const row = (e: WOEvent, i: number) => (
    <EventRow
      key={e.id}
      e={e}
      venue={venues.get(e.venueId)}
      day={nextDay(e)}
      today={today}
      baseline={baseline}
      followed={prefs.follows.includes(e.venueId)}
      saved
      onToggleSaved={() => toggleSaved(e.id)}
      index={i}
      dated
    />
  );

  return (
    <>
      <header className="masthead">
        <p className="kicker">
          <span className="kicker__dot" /> Saved
        </p>
        <h1 className="dateline">
          {upcoming.length ? (
            <>
              <em>{upcoming.length}</em> {upcoming.length === 1 ? "thing" : "things"} saved
            </>
          ) : (
            <>
              <em>Nothing</em> saved yet
            </>
          )}
        </h1>
      </header>

      {saved.length === 0 && gone.length === 0 && (
        <Empty>
          <p>Tap {Icon.star(false)} on any listing to keep it here, with your plans in date order.</p>
          <p className="row__desc">
            Browse the <Link href="/">calendar</Link> or <Link href="/feed/">feed</Link>.
          </p>
        </Empty>
      )}

      {onToday > 0 && <p className="nudge">{onToday === 1 ? "One of your plans is today." : `${onToday} of your plans are today.`}</p>}

      {thisWeek.length > 0 && (
        <section className="section">
          <SectionHead title="This week" count={thisWeek.length} />
          <div className="rows">{thisWeek.map(row)}</div>
        </section>
      )}

      {later.length > 0 && (
        <section className="section">
          <SectionHead title="Later" count={later.length} />
          <div className="rows">{later.map(row)}</div>
        </section>
      )}

      <p className="nudge">
        <Link href="/sync/">{"Sync with your other devices"}</Link> — keep places, people and saved events the same on your phone and laptop.
      </p>

      {gone.length > 0 && (
        <p className="colophon">
          {gone.length === 1 ? "1 saved listing has" : `${gone.length} saved listings have`} finished or gone from the listings.{" "}
          <button className="link-button" onClick={() => set({ saved: prefs.saved.filter((id) => !gone.includes(id)) })}>
            Clear {gone.length === 1 ? "it" : "them"}
          </button>
        </p>
      )}
    </>
  );
}
