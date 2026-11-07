"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AppData, VenueLite } from "@/lib/data";
import { THEME_GROUP_LABEL, type Person, type ThemeGroup, type WOEvent } from "@/lib/types";
import { buildProfile, isAct, isEmpty, recommendEvents, recommendPeople, recommendVenues, themeShare, topThemes, whyText, type Profile, type Why } from "@/lib/profile";
import { laterDay, usePrefs, useHydrated } from "@/lib/store";
import { useAppData, usePeopleData } from "@/lib/useData";
import { addDays, londonToday } from "@/lib/when";
import { EventRow } from "./EventRow";
import { PERSON_KIND_LABEL } from "./PlacesView";
import { Empty, Icon, LoadError, SectionHead } from "./ui";

export function DiscoverView() {
  const { data, error } = useAppData();
  if (error) return <LoadError message={error} />;
  if (!data) return <DiscoverSkeleton />;
  return <Discover data={data} />;
}

export function DiscoverSkeleton() {
  return (
    <header className="masthead" aria-busy="true">
      <p className="kicker">
        <span className="kicker__dot" /> Discover
      </p>
      <h1 className="dateline skeleton">&nbsp;</h1>
    </header>
  );
}

const lastDay = (e: WOEvent) => e.endDate ?? (e.ongoing ? "9999" : (e.startDate ?? "9999"));

function Discover({ data }: { data: AppData }) {
  const hydrated = useHydrated();
  const theme = useSearchParams().get("theme");
  const { prefs, toggleSaved, toggleFollow, togglePerson, toggleLike } = usePrefs();
  const { people } = usePeopleData(true);
  const [today, setToday] = useState("");
  const [picking, setPicking] = useState(false);
  useEffect(() => setToday(londonToday()), []);
  useEffect(() => window.scrollTo(0, 0), [theme]);

  const venues = useMemo(() => new Map(data.venues.map((v) => [v.id, v])), [data.venues]);
  const events = useMemo(() => new Map(data.events.map((e) => [e.id, e])), [data.events]);
  const persons = useMemo(() => new Map((people?.people ?? []).map((p) => [p.id, p])), [people]);
  const labels = useMemo(() => new Map(data.themes.map((t) => [t.id, t.label])), [data.themes]);
  const groups = useMemo(() => new Map(data.themes.map((t) => [t.id, t.group as string])), [data.themes]);
  const share = useMemo(() => themeShare(data.events), [data.events]);
  const firstScrape = useMemo(() => data.events.reduce((m, e) => (e.firstSeen < m ? e.firstSeen : m), "9999"), [data.events]);

  const profile: Profile = useMemo(
    () =>
      buildProfile(prefs, {
        venue: (id) => venues.get(id),
        event: (id) => events.get(id),
        person: (id) => persons.get(id),
        group: (id) => groups.get(id),
      }),
    [prefs, venues, events, persons, groups],
  );

  // First visit with nothing to go on: open the theme picker (and keep it open while you pick).
  const empty = isEmpty(profile);
  useEffect(() => {
    if (hydrated && today && empty) setPicking(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, today]);

  if (!hydrated || !today) return <DiscoverSkeleton />;

  const follows = new Set(prefs.follows);
  const following = new Set(prefs.people);
  const saved = new Set(prefs.saved);
  const likes = new Set(prefs.likes);
  // What's on: running now, or starting in the next couple of months.
  const current = data.events.filter((e) => lastDay(e) >= today && (!e.startDate || e.startDate <= addDays(today, 60)));
  const onNow: Record<string, number> = {};
  for (const e of current) onNow[e.venueId] = (onNow[e.venueId] ?? 0) + 1;
  // How many upcoming London dates each performer has (here or at venues we don't list).
  const dates = new Map<string, number>();
  for (const e of [...current, ...(people?.elsewhere ?? []).filter((x) => lastDay(x) >= today)])
    for (const id of e.people ?? []) dates.set(id, (dates.get(id) ?? 0) + 1);
  const withDates = new Set(dates.keys());

  const nextDay = (e: WOEvent) => (e.startDate && e.startDate > today ? e.startDate : today);
  const row = (e: WOEvent, i: number, why?: string) => (
    <EventRow
      key={e.id}
      e={e}
      venue={venues.get(e.venueId)}
      day={nextDay(e)}
      today={today}
      baseline={laterDay(firstScrape, prefs.seenUpTo)}
      followed={follows.has(e.venueId) || !!e.people?.some((p) => following.has(p))}
      saved={saved.has(e.id)}
      onToggleSaved={() => toggleSaved(e.id)}
      index={i}
      dated
      why={why}
    />
  );
  const placeRow = (v: VenueLite, i: number, why?: string) => {
    const on = follows.has(v.id);
    return (
      <li key={v.id} className="place" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
        <Link href={`/places/${v.id}/`} className="place__main">
          <span className="place__name">{v.name}</span>
          <span className="place__meta">
            {v.area}
            {onNow[v.id] ? ` · ${onNow[v.id]} on` : ""}
            {why ? <span className="place__why"> · {why}</span> : null}
          </span>
        </Link>
        <button className={`follow${on ? " is-on" : ""}`} onClick={() => toggleFollow(v.id)} aria-pressed={on} aria-label={on ? `Unfollow ${v.name}` : `Follow ${v.name}`}>
          {on ? Icon.check : Icon.plus}
          <span>{on ? "Following" : "Follow"}</span>
        </button>
      </li>
    );
  };
  const personRow = (p: Person, i: number, why?: string) => {
    const on = following.has(p.id);
    return (
      <li key={p.id} className="place" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
        <Link href={`/person/?id=${encodeURIComponent(p.id)}`} className="place__main">
          <span className="place__name">{p.name}</span>
          <span className="place__meta">
            {PERSON_KIND_LABEL[p.kind]}
            {why ? <span className="place__why"> · {why}</span> : null}
          </span>
        </Link>
        <button className={`follow${on ? " is-on" : ""}`} onClick={() => togglePerson(p.id)} aria-pressed={on} aria-label={on ? `Unfollow ${p.name}` : `Follow ${p.name}`}>
          {on ? Icon.check : Icon.plus}
          <span>{on ? "Following" : "Follow"}</span>
        </button>
      </li>
    );
  };

  const picker = (
    <div className="picker">
      {(Object.keys(THEME_GROUP_LABEL) as ThemeGroup[]).map((g) => (
        <div key={g}>
          <h3>{THEME_GROUP_LABEL[g]}</h3>
          <div className="chips" role="group" aria-label={THEME_GROUP_LABEL[g]}>
            {data.themes
              .filter((t) => t.group === g)
              .map((t) => (
                <button key={t.id} className="chip" aria-pressed={likes.has(t.id)} onClick={() => toggleLike(t.id)}>
                  {t.label}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );

  // ---------------------------------------------------------------- one theme
  if (theme && labels.has(theme)) {
    const label = labels.get(theme)!;
    const has = (themes?: string[]) => !!themes?.includes(theme);
    const rank = (themes?: string[]) => themes?.indexOf(theme) ?? 9;
    const list = current
      .filter((e) => has(e.themes))
      .sort((a, b) => nextDay(a).localeCompare(nextDay(b)) || lastDay(a).localeCompare(lastDay(b)) || a.title.localeCompare(b.title));
    const places = data.venues
      .filter((v) => has(v.themes))
      .sort((a, b) => rank(a.themes) - rank(b.themes) || (onNow[b.id] ?? 0) - (onNow[a.id] ?? 0) || a.name.localeCompare(b.name));
    const acts = (people?.people ?? []).filter((p) => isAct(p) && has(p.themes) && withDates.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <>
        <header className="masthead masthead--venue">
          <p className="kicker">
            <Link href="/discover/">← Discover</Link>
          </p>
          <h1 className="venue-name">{label}</h1>
          <p className="venue-meta">
            {list.length} on · {places.length} places
          </p>
          <button className={`follow follow--big${likes.has(theme) ? " is-on" : ""}`} onClick={() => toggleLike(theme)} aria-pressed={likes.has(theme)}>
            {likes.has(theme) ? Icon.check : Icon.plus}
            <span>{likes.has(theme) ? "You’re into this" : "I’m into this"}</span>
          </button>
        </header>
        <section className="section">
          <SectionHead title="On now and coming up" count={list.length} />
          {list.length ? <div className="rows">{list.slice(0, 80).map((e, i) => row(e, i))}</div> : <Empty><p>Nothing listed under {label} right now.</p></Empty>}
        </section>
        {places.length > 0 && (
          <section className="section">
            <SectionHead title="Places" count={places.length} />
            <ul className="places">{places.slice(0, 40).map((v, i) => placeRow(v, i))}</ul>
          </section>
        )}
        {acts.length > 0 && (
          <section className="section">
            <SectionHead title="People with London dates" count={acts.length} />
            <ul className="places">{acts.slice(0, 40).map((p, i) => personRow(p, i))}</ul>
          </section>
        )}
      </>
    );
  }

  // ---------------------------------------------------------------- for you
  const into = topThemes(profile, 8);
  const picks = recommendEvents(profile, data.events, {
    today,
    follows,
    people: following,
    saved,
    visited: new Set(prefs.visited),
    share,
    venue: (id) => venues.get(id),
    limit: 24,
  });
  const placePicks = recommendVenues(profile, data.venues, onNow, follows, 8, share);
  const peoplePicks = people ? recommendPeople(profile, people.people, dates, following, 6) : [];
  const label = (id: string) => labels.get(id);
  // Places and people: the theme, and the place of yours it's like ("Design · like Design Museum").
  const shortWhy = (w: Why) => `${label(w.theme) ?? w.theme}${w.source?.kind === "venue" ? ` · like ${w.source.name}` : ""}`;

  return (
    <>
      <header className="masthead">
        <p className="kicker">
          <span className="kicker__dot" /> Discover
        </p>
        <h1 className="dateline">{into.length ? <><em>Picked</em> for you</> : <><em>Find</em> your London</>}</h1>
      </header>

      {!into.length ? (
        <section className="section">
          <p className="nudge">
            Discover learns what you’re into from the places and people you follow and the things you save. To get started, pick a few themes you like:
          </p>
          {picker}
        </section>
      ) : (
        <section className="section">
          <SectionHead
            title="You’re into"
            action={
              <button className="link-button" onClick={() => setPicking(!picking)} aria-expanded={picking}>
                {picking ? "Done" : "Choose themes"}
              </button>
            }
          />
          {picking ? (
            picker
          ) : (
            <p className="themes">
              {into.map((id) => (
                <Link key={id} href={`/discover/?theme=${id}`} className="theme-chip">
                  {labels.get(id)}
                </Link>
              ))}
            </p>
          )}
        </section>
      )}

      {picks.length > 0 && (
        <section className="section">
          <SectionHead title="For you" count={picks.length} />
          <div className="rows">{picks.map((p, i) => row(p.item, i, whyText(p.why, label)))}</div>
        </section>
      )}

      {placePicks.length > 0 && (
        <section className="section">
          <SectionHead title="Places you might like" />
          <ul className="places">{placePicks.map((p, i) => placeRow(p.item, i, shortWhy(p.why)))}</ul>
        </section>
      )}

      {peoplePicks.length > 0 && (
        <section className="section">
          <SectionHead title="People you might like" />
          <ul className="places">{peoplePicks.map((p, i) => personRow(p.item, i, shortWhy(p.why)))}</ul>
        </section>
      )}

      <section className="section">
        <SectionHead title="Explore by theme" />
        {(Object.keys(THEME_GROUP_LABEL) as ThemeGroup[]).map((g) => (
          <div key={g} className="picker">
            <h3>{THEME_GROUP_LABEL[g]}</h3>
            <p className="themes">
              {data.themes
                .filter((t) => t.group === g)
                .map((t) => (
                  <Link key={t.id} href={`/discover/?theme=${t.id}`} className="theme-chip">
                    {t.label}
                  </Link>
                ))}
            </p>
          </div>
        ))}
      </section>
    </>
  );
}
