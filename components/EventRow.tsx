"use client";

import Link from "next/link";
import { useState } from "react";
import type { VenueLite } from "@/lib/data";
import type { WOEvent } from "@/lib/types";
import { BADGE_LABEL, badges, icsFor, rangeText, whenText } from "@/lib/when";
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

  const addToCalendar = () => {
    const blob = new Blob([icsFor(e, venue?.name ?? "", day)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${e.title.slice(0, 40).replace(/[^\w]+/g, "-")}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const share = async () => {
    const text = `${e.title} — ${venue?.name ?? ""} (${rangeText(e)})`;
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
        {showVenue && venue && <span className={`row__venue${followed ? " is-followed" : ""}`}>{venue.name}</span>}
        <span className="row__title">{e.title}</span>
        <span className="row__meta">
          <span className="row__type">{TYPE_LABEL[e.type]}</span>
          {closed && <span className="badge badge--closed">Venue closed</span>}
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
          {e.description && <p className="row__desc">{e.description}</p>}
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
