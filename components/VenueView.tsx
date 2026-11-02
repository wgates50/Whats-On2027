"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { VenueLite } from "@/lib/data";
import type { WOEvent } from "@/lib/types";
import { usePrefs, useHydrated } from "@/lib/store";
import { addEventUrl } from "@/lib/site";
import { dayOfWeek, isOnDay, isOneOff, londonToday } from "@/lib/when";
import { closedDaysText, type Week } from "@/lib/hours";
import { EventRow } from "./EventRow";
import { KIND_LABEL } from "./PlacesView";
import { Empty, Icon, SectionHead } from "./ui";

export function VenueView({ venue, events, baseline }: { venue: VenueLite; events: WOEvent[]; baseline: string }) {
  const hydrated = useHydrated();
  const { prefs, toggleFollow, toggleSaved } = usePrefs();
  const [today, setToday] = useState("");
  useEffect(() => setToday(londonToday()), []);
  const saved = useMemo(() => new Set(prefs.saved), [prefs.saved]);
  const on = hydrated && prefs.follows.includes(venue.id);

  const t = today || "0000-00-00";
  const lastDay = (e: WOEvent) => e.endDate ?? (e.ongoing ? "9999" : e.startDate ?? "9999");
  const current = events.filter((e) => lastDay(e) >= t);
  const nowOn = current.filter((e) => !isOneOff(e) && isOnDay(e, t, t)).sort((a, b) => (a.endDate ?? "9999").localeCompare(b.endDate ?? "9999"));
  const dated = current
    .filter((e) => isOneOff(e) || (e.startDate && e.startDate > t))
    .filter((e) => !nowOn.includes(e))
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  const row = (e: WOEvent, i: number, day: string) => (
    <EventRow
      key={e.id}
      e={e}
      venue={venue}
      day={day}
      today={t}
      baseline={baseline}
      followed={on}
      saved={saved.has(e.id)}
      onToggleSaved={() => toggleSaved(e.id)}
      showVenue={false}
      index={i}
      dated
    />
  );

  return (
    <>
      <header className="masthead masthead--venue">
        <p className="kicker">
          <Link href="/places/">← Places</Link>
        </p>
        <h1 className="venue-name">{venue.name}</h1>
        <p className="venue-meta">
          {venue.area} · {KIND_LABEL[venue.kind]} ·{" "}
          <a href={venue.website} target="_blank" rel="noopener noreferrer">
            Website {Icon.arrow}
          </a>
        </p>
        <button className={`follow follow--big${on ? " is-on" : ""}`} onClick={() => toggleFollow(venue.id)} aria-pressed={on}>
          {on ? Icon.check : Icon.plus}
          <span>{on ? "Following" : "Follow"}</span>
        </button>
      </header>

      {venue.hours && today && <Hours week={venue.hours} partial={!!venue.hoursPartial} today={today} />}

      {venue.coverage === "manual" && (
        <p className="nudge">
          {venue.name}’s website doesn’t allow automated listings, so events here are added by hand.{" "}
          <a href={addEventUrl({ venue: venue.name })}>Add one</a>.
        </p>
      )}
      {venue.coverage === "soon" && (
        <p className="nudge">Listings for {venue.name} aren’t automated yet — it’s in the maintenance queue.</p>
      )}

      {hydrated && today && (
        <>
          {nowOn.length > 0 && (
            <section className="section">
              <SectionHead title="On now" count={nowOn.length} />
              <div className="rows">{nowOn.map((e, i) => row(e, i, t))}</div>
            </section>
          )}
          {dated.length > 0 && (
            <section className="section">
              <SectionHead title="Coming up" count={dated.length} />
              <div className="rows">{dated.map((e, i) => row(e, i, e.startDate && e.startDate > t ? e.startDate : t))}</div>
            </section>
          )}
          {nowOn.length + dated.length === 0 && (
            <Empty>
              <p>Nothing listed right now.</p>
            </Empty>
          )}
        </>
      )}

      <p className="colophon">
        Something missing? <a href={addEventUrl({ venue: venue.name })}>Add an event here</a>.
      </p>
    </>
  );
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Hours({ week, partial, today }: { week: Week; partial: boolean; today: string }) {
  const dow = dayOfWeek(today);
  const now = week[dow];
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  return (
    <details className="hours">
      <summary>
        <span className={`hours__now${now ? "" : " is-closed"}`}>{now ? `Open today · ${now}` : "Closed today"}</span>
        {closedDaysText(week) && <span className="hours__closed">{closedDaysText(week)}</span>}
      </summary>
      <dl>
        {order.map((d) => (
          <div key={d} className={d === dow ? "is-today" : undefined}>
            <dt>{DAY_NAMES[d]}</dt>
            <dd>{week[d] ?? "Closed"}</dd>
          </div>
        ))}
      </dl>
      <p className="hours__note">
        Regular hours from OpenStreetMap{partial ? " (holiday hours not shown)" : ""} — check the venue’s site before a special trip. ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          OpenStreetMap contributors
        </a>
      </p>
    </details>
  );
}
