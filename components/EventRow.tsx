"use client";

import Link from "next/link";
import { useState } from "react";
import type { VenueLite } from "@/lib/data";
import type { WOEvent } from "@/lib/types";
import { usePrefs } from "@/lib/store";
import { usePeopleData } from "@/lib/useData";
import { BADGE_LABEL, badges, darkDaysText, icsFor, isOneOff, londonParts, notOnSaleYet, performancesOn, rangeText, shortDate, weekdayShort, whenInstant, whenText } from "@/lib/when";
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
}) {
  const [open, setOpen] = useState(false);
  const b = badges(e, day, today).filter((x) => x !== "new" || e.firstSeen > baseline);
  const when = whenText(e, day);
  const venueName = venue?.name ?? e.venueName;
  // Runs with a Ticketmaster schedule: that day's times, or no performance at all.
  const perf = isOneOff(e) ? null : performancesOn(e, day);
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
        </span>
      </button>
      <button className={`row__save${saved ? " is-saved" : ""}`} onClick={onToggleSaved} aria-pressed={saved} aria-label={saved ? "Remove from plans" : "Save to plans"}>
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
          {e.people?.length ? <People ids={e.people} /> : null}
          <div className="row__actions">
            <a href={e.url} target="_blank" rel="noopener noreferrer">
              {VIA[e.sourceId] ? `View on ${VIA[e.sourceId]}` : "Visit site"} {Icon.arrow}
            </a>
            <button onClick={addToCalendar}>Add to calendar</button>
            <button onClick={share}>Share</button>
            {venue && showVenue && <Link href={`/places/${venue.id}/`}>{venue.name}</Link>}
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
