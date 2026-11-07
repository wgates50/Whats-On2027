"use client";

import Link from "next/link";
import { useState } from "react";
import type { VenueLite } from "@/lib/data";
import type { WOEvent } from "@/lib/types";
import { memoOf, usePrefs } from "@/lib/store";
import { usePeopleData } from "@/lib/useData";
import { BADGE_LABEL, badges, darkDaysText, dayOfWeek, icsFor, isOneOff, londonParts, notOnSaleYet, performancesOn, rangeText, shortDate, weekdayShort, whenInstant, whenText } from "@/lib/when";
import { ThemeChips } from "./ThemeChips";
import { Icon } from "./ui";

const TYPE_LABEL: Record<WOEvent["type"], string> = {
  exhibition: "Exhibition",
  display: "Display",
  show: "Show",
  concert: "Concert",
  talk: "Talk",
  tour: "Tour",
  late: "Late",
  workshop: "Workshop",
  family: "Family",
  screening: "Film",
  event: "Event",
};

/** Ticket APIs whose terms ask us to credit them; their events link to their pages. */
const VIA: Record<string, string> = { ticketmaster: "Ticketmaster", skiddle: "Skiddle" };

export function EventRow({
  e,
  venue,
  day,
  today,
  baseline,
  followed,
  saved,
  onToggleSaved,
  showVenue = true,
  index = 0,
  closed = false,
  dated = false,
  why,
}: {
  e: WOEvent;
  venue?: VenueLite;
  day: string;
  today: string;
  baseline: string;
  followed: boolean;
  saved: boolean;
  onToggleSaved: () => void;
  showVenue?: boolean;
  index?: number;
  /** The venue is shut on the day being viewed (from its regular opening hours). */
  closed?: boolean;
  /** Lists that aren't about one day (feed, venue and people pages): show a one-off's date, not just its time. */
  dated?: boolean;
  /** Why it's suggested (Discover), e.g. "Because you like Photography". */
  why?: string;
}) {
  const [open, setOpen] = useState(false);
  const { prefs, toggleVisited, remember } = usePrefs();
  const been = prefs.visited.includes(e.id);
  // You can only have been to something that's started.
  const canHaveBeen = !e.startDate || e.startDate <= today;
  const visitDay = e.startDate && e.startDate > today ? e.startDate : isOneOff(e) && e.startDate ? e.startDate : today;
  const toggleSave = () => {
    onToggleSaved();
    // Remember what it was, so it still counts for your taste once it's gone from the listings.
    if (!saved) remember({ [e.id]: memoOf(e, e.startDate && e.startDate > today ? e.startDate : today) });
  };
  // Lists that aren't about one day describe a run as of today ("Opens 20 Nov", not "Opens today").
  const ref = dated && !isOneOff(e) ? today : day;
  const b = badges(e, ref, today).filter((x) => x !== "new" || e.firstSeen > baseline);
  const when =
    dated && isOneOff(e) && e.startDate && !(e.endDate && e.endDate !== e.startDate)
      ? `${e.startDate === today ? "Today" : `${weekdayShort(e.startDate)} ${shortDate(e.startDate, e.startDate.slice(0, 4) !== today.slice(0, 4))}`}${e.startTime ? ` · ${e.startTime}` : ""}`
      : whenText(e, ref);
  const venueName = venue?.name ?? e.venueName;
  // Runs with a Ticketmaster schedule: that day's times, or no performance at all.
  const perf = isOneOff(e) || (e.startDate && e.startDate > ref) ? null : performancesOn(e, ref);
  const times = perf?.filter(Boolean) ?? [];
  const now = new Date().toISOString();
  const onSaleSoon = notOnSaleYet(e, now);

  const addToCalendar = () => {
    const blob = new Blob([icsFor(e, venueName ?? "", day)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${e.title.slice(0, 40).replace(/[^\w]+/g, "-")}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const share = async () => {
    const text = `${e.title} — ${venueName ?? ""} (${rangeText(e)})`;
    try {
      if (navigator.share) await navigator.share({ title: e.title, text, url: e.url });
      else await navigator.clipboard.writeText(`${text} ${e.url}`);
    } catch {
      /* dismissed */
    }
  };

  return (
    <article className={`row${open ? " row--open" : ""}`} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
      <div className="row__when">{when}</div>
      <button className="row__main" onClick={() => setOpen(!open)} aria-expanded={open}>
        {showVenue && venueName && <span className={`row__venue${followed ? " is-followed" : ""}`}>{venueName}</span>}
        <span className="row__title">{e.title}</span>
        <span className="row__meta">
          <span className="row__type">{TYPE_LABEL[e.type]}</span>
          {times.length > 0 && <span className="row__times">{times.join(" · ")}</span>}
          {closed && <span className="badge badge--closed">Venue closed</span>}
          {!closed && perf?.length === 0 && <span className="badge badge--closed">No performance</span>}
          {onSaleSoon && <span className="badge badge--onsale">On sale {onSaleDay(e.onSale!.start, today)}</span>}
          {b.map((x) => (
            <span key={x} className={`badge badge--${x}`}>
              {BADGE_LABEL[x]}
            </span>
          ))}
          {been && <span className="badge badge--been">Been</span>}
          {why && <span className="row__why">{why}</span>}
        </span>
      </button>
      <button className={`row__save${saved ? " is-saved" : ""}`} onClick={toggleSave} aria-pressed={saved} aria-label={saved ? "Remove from plans" : "Save to plans"}>
        {Icon.star(saved)}
      </button>
      {open && (
        <div className="row__details">
          {e.image && (
            <img
              className="row__image"
              src={e.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(ev) => (ev.currentTarget.style.display = "none")}
            />
          )}
          <p className="row__range">{rangeText(e)}</p>
          {showVenue && venueName && <Where venue={venue} name={venueName} e={e} day={ref} today={today} />}
          {darkDaysText(e) && <p className="row__note">{darkDaysText(e)}</p>}
          {onSaleSoon && (
            <p className="row__note">
              General sale {whenInstant(e.onSale!.start, today)}
              {e.onSale!.presales?.map((p) => (
                <span key={p.name + p.start}>
                  <br />
                  {p.name}: {whenInstant(p.start, today)}
                </span>
              ))}
            </p>
          )}
          {e.description && <p className="row__desc">{e.description}</p>}
          <ThemeChips ids={e.themes} />
          {e.people?.length ? <People ids={e.people} /> : null}
          <div className="row__actions">
            <a href={e.url} target="_blank" rel="noopener noreferrer">
              {VIA[e.sourceId] ? `View on ${VIA[e.sourceId]}` : "Visit site"} {Icon.arrow}
            </a>
            {canHaveBeen && (
              <button className={been ? "is-been" : undefined} onClick={() => toggleVisited(e.id, memoOf(e, visitDay))} aria-pressed={been}>
                {been ? "✓ Been" : "I’ve been"}
              </button>
            )}
            <button onClick={addToCalendar}>Add to calendar</button>
            <button onClick={share}>Share</button>
          </div>
        </div>
      )}
    </article>
  );
}

/** "today", "Fri 6 Nov" — the day general sale opens. */
function onSaleDay(iso: string, today: string): string {
  const { day } = londonParts(iso);
  return day === today ? "today" : `${weekdayShort(day)} ${shortDate(day)}`;
}

/** Who's on, with follow buttons (names come from people.json, fetched when a row is opened). */
function People({ ids }: { ids: string[] }) {
  const { people } = usePeopleData(true);
  const { prefs, togglePerson } = usePrefs();
  const byId = new Map((people?.people ?? []).map((p) => [p.id, p]));
  const known = ids.map((id) => byId.get(id)).filter((p) => !!p);
  if (!known.length) return null;
  return (
    <p className="row__people">
      {known.slice(0, 6).map((p) => {
        const on = prefs.people.includes(p.id);
        return (
          <span key={p.id} className="person-chip">
            <Link href={`/person/?id=${encodeURIComponent(p.id)}`}>{p.name}</Link>
            <button className={`person-chip__follow${on ? " is-on" : ""}`} onClick={() => togglePerson(p.id)} aria-pressed={on} aria-label={on ? `Unfollow ${p.name}` : `Follow ${p.name}`}>
              {on ? Icon.check : Icon.plus}
            </button>
          </span>
        );
      })}
    </p>
  );
}

/** Where it is: the venue (linked), its area, its hours that day for things you drop in on, and directions. */
function Where({ venue, name, e, day, today }: { venue?: VenueLite; name: string; e: WOEvent; day: string; today: string }) {
  const dropIn = !isOneOff(e) && (e.category === "exhibitions" || e.type === "display" || e.type === "exhibition");
  const h = dropIn ? venue?.hours?.[dayOfWeek(day)] : undefined;
  const when = day === today ? "today" : weekdayShort(day);
  const hours = !dropIn || !venue?.hours ? null : h ? `Open ${when} ${h}` : `Closed ${when}`;
  const maps = venue?.lat && venue.lng ? `https://www.google.com/maps/search/?api=1&query=${venue.lat}%2C${venue.lng}` : null;
  return (
    <p className="row__where">
      {venue ? <Link href={`/places/${venue.id}/`}>{venue.name}</Link> : name}
      {venue?.area ? <span> · {venue.area}</span> : null}
      {hours ? <span> · {hours}</span> : null}
      {maps ? (
        <span>
          {" · "}
          <a href={maps} target="_blank" rel="noopener noreferrer">
            Directions {Icon.arrow}
          </a>
        </span>
      ) : null}
    </p>
  );
}
