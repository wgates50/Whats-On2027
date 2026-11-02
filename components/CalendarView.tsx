"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData } from "@/lib/data";
import type { Category, WOEvent } from "@/lib/types";
import { usePrefs, useHydrated } from "@/lib/store";
import { addDays, dayNum, isOnDay, isOneOff, londonToday, monthShort, weekdayLong, weekdayShort, longDate, daysBetween, noPerformanceOn, venueClosedOn } from "@/lib/when";
import { useAppData, usePeopleData } from "@/lib/useData";
import { EventRow } from "./EventRow";
import { Empty, LoadError, SectionHead } from "./ui";

const STRIP_DAYS = 35;
const COLLAPSED = 10;

type Cat = "all" | Category;
const CATS: { id: Cat; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "exhibitions", label: "Exhibitions" },
  { id: "shows", label: "Shows" },
  { id: "art-events", label: "Art events" },
];

export function CalendarView() {
  const { data, error } = useAppData();
  if (error) return <LoadError message={error} />;
  if (!data) return <CalendarSkeleton />;
  return <Calendar data={data} />;
}

function Calendar({ data }: { data: AppData }) {
  const hydrated = useHydrated();
  const { prefs, toggleSaved, set } = usePrefs();
  const [today, setToday] = useState<string>("");
  const [day, setDay] = useState<string>("");
  const [cat, setCat] = useState<Cat>("all");
  const [freeOnly, setFreeOnly] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  // Work out "today" in London on the device, and honour ?d=YYYY-MM-DD links.
  useEffect(() => {
    const t = londonToday();
    setToday(t);
    const q = new URLSearchParams(location.search).get("d");
    setDay(q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q >= t ? q : t);
    const c = new URLSearchParams(location.search).get("c") as Cat | null;
    if (c && CATS.some((x) => x.id === c)) setCat(c);
  }, []);

  useEffect(() => {
    if (!day || !today) return;
    const p = new URLSearchParams(location.search);
    if (day === today) p.delete("d");
    else p.set("d", day);
    if (cat === "all") p.delete("c");
    else p.set("c", cat);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
    stripRef.current?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [day, cat, today]);

  const venues = useMemo(() => new Map(data.venues.map((v) => [v.id, v])), [data.venues]);
  const baseline = useMemo(() => data.events.reduce((m, e) => (e.firstSeen < m ? e.firstSeen : m), "9999"), [data.events]);
  const follows = useMemo(() => new Set(prefs.follows), [prefs.follows]);
  const followedPeople = useMemo(() => new Set(prefs.people), [prefs.people]);
  const saved = useMemo(() => new Set(prefs.saved), [prefs.saved]);
  const anyFollows = follows.size + followedPeople.size > 0;
  const mine = prefs.onlyMine && anyFollows;
  // Dates of people you follow at venues we don't list (people.json, only fetched if you follow someone).
  const { people } = usePeopleData(followedPeople.size > 0);
  const byPerson = (e: WOEvent) => !!e.people?.some((p) => followedPeople.has(p));
  const isMine = (e: WOEvent) => follows.has(e.venueId) || byPerson(e);

  const pool = useMemo(() => {
    const elsewhere = (people?.elsewhere ?? []).filter((e) => e.people?.some((p) => followedPeople.has(p)));
    return [...data.events, ...elsewhere].filter(
      (e) => (!mine || follows.has(e.venueId) || e.people?.some((p) => followedPeople.has(p))) && (cat === "all" || e.category === cat) && (!freeOnly || e.price === "free"),
    );
  }, [data.events, people, mine, follows, followedPeople, cat, freeOnly]);

  // Dots on the day strip: days with one-off events in the current filter.
  const busy = useMemo(() => {
    const m = new Map<string, number>();
    if (!today) return m;
    const last = addDays(today, STRIP_DAYS);
    for (const e of pool) {
      if (!isOneOff(e) || !e.startDate) continue;
      const end = e.endDate ?? e.startDate;
      for (let d = e.startDate < today ? today : e.startDate; d <= end && d <= last; d = addDays(d, 1)) m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  }, [pool, today]);

  if (!hydrated || !day) return <CalendarSkeleton />;

  const onDay = pool.filter((e) => isOnDay(e, day, today));
  const happening = onDay.filter(isOneOff).sort((a, b) => (a.startTime ?? "99").localeCompare(b.startTime ?? "99") || a.title.localeCompare(b.title));
  const runs = onDay.filter((e) => !isOneOff(e));
  const closedHere = (e: WOEvent) => !isOneOff(e) && venueClosedOn(venues.get(e.venueId)?.hours, day);
  const rank = (e: WOEvent) => {
    let r = isMine(e) ? 0 : 100;
    if (closedHere(e) || noPerformanceOn(e, day)) r += 60; // shut / dark today: still listed, but below what you can actually see
    if (e.startDate === day) r -= 30; // opens today
    if (e.endDate && daysBetween(day, e.endDate) <= 7) r -= 20; // last days
    return r;
  };
  const sortRuns = (a: WOEvent, b: WOEvent) => rank(a) - rank(b) || (a.endDate ?? "9999").localeCompare(b.endDate ?? "9999");
  const exhibitions = runs.filter((e) => e.category === "exhibitions").sort(sortRuns);
  const shows = runs.filter((e) => e.category === "shows").sort(sortRuns);
  const otherRuns = runs.filter((e) => e.category === "art-events").sort(sortRuns);

  const rowProps = (e: WOEvent, i: number) => ({
    e,
    venue: venues.get(e.venueId),
    day,
    today,
    baseline,
    followed: isMine(e),
    saved: saved.has(e.id),
    onToggleSaved: () => toggleSaved(e.id),
    index: i,
    closed: closedHere(e),
  });

  const isToday = day === today;
  const strip = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i));

  return (
    <>
      <header className="masthead">
        <p className="kicker">
          <span className="kicker__dot" /> London · {isToday ? "Today" : daysBetween(today, day) === 1 ? "Tomorrow" : weekdayShort(day)}
        </p>
        <h1 className="dateline">
          <em>{weekdayLong(day)}</em> {longDate(day)}
        </h1>
      </header>

      <div className="days" ref={stripRef} role="listbox" aria-label="Choose a day">
        {strip.map((d) => {
          const first = d.endsWith("-01") || d === today;
          return (
            <button
              key={d}
              data-day={d}
              role="option"
              aria-selected={d === day}
              className={`day${d === day ? " is-selected" : ""}${d === today ? " is-today" : ""}`}
              onClick={() => setDay(d)}
            >
              <span className="day__wd">{weekdayShort(d).slice(0, 2)}</span>
              <span className="day__n">{dayNum(d)}</span>
              <span className="day__mo">{first ? monthShort(d) : ""}</span>
              {busy.get(d) ? <span className="day__dot" aria-label={`${busy.get(d)} events`} /> : null}
            </button>
          );
        })}
        <label className="day day--pick" title="Pick a date">
          <span className="day__wd">Go</span>
          <span className="day__n">…</span>
          <input type="date" min={today} value={day} onChange={(ev) => ev.target.value && setDay(ev.target.value)} aria-label="Pick a date" />
        </label>
      </div>

      <div className="chips" role="toolbar" aria-label="Filters">
        {CATS.map((c) => (
          <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
        <span className="chips__sep" />
        <button className="chip chip--quiet" aria-pressed={freeOnly} onClick={() => setFreeOnly(!freeOnly)}>
          Free
        </button>
        {anyFollows && (
          <button className="chip chip--quiet" aria-pressed={mine} onClick={() => set({ onlyMine: !prefs.onlyMine })}>
            Following
          </button>
        )}
      </div>

      {!anyFollows && (
        <p className="nudge">
          Showing everything in London. <Link href="/places/">Follow a few places</Link> or{" "}
          <Link href="/places/?show=people">people</Link> to turn this into your calendar.
        </p>
      )}

      {onDay.length === 0 && (
        <Empty>
          <p>Nothing listed {mine ? "for what you follow" : ""} on {weekdayLong(day)}.</p>
          {mine && (
            <button className="link-button" onClick={() => set({ onlyMine: false })}>
              See everything in London
            </button>
          )}
        </Empty>
      )}

      <Section title={isToday ? "Happening today" : "Happening"} items={happening} render={rowProps} empty={null} />
      <Section title="Exhibitions on" items={exhibitions} render={rowProps} />
      <Section title="Shows running" items={shows} render={rowProps} />
      <Section title="Ongoing events" items={otherRuns} render={rowProps} />
    </>
  );
}

function Section({
  title,
  items,
  render,
  empty,
}: {
  title: string;
  items: WOEvent[];
  render: (e: WOEvent, i: number) => React.ComponentProps<typeof EventRow>;
  empty?: React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  if (!items.length) return empty ?? null;
  const shown = all ? items : items.slice(0, COLLAPSED);
  return (
    <section className="section">
      <SectionHead title={title} count={items.length} />
      <div className="rows">
        {shown.map((e, i) => (
          <EventRow key={e.id} {...render(e, i)} />
        ))}
      </div>
      {items.length > COLLAPSED && (
        <button className="more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

function CalendarSkeleton() {
  return (
    <div aria-busy="true">
      <header className="masthead">
        <p className="kicker">London</p>
        <h1 className="dateline skeleton">&nbsp;</h1>
      </header>
      <div className="days">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="day skeleton" />
        ))}
      </div>
    </div>
  );
}
