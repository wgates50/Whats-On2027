// App-wide constants. Rename the app here (one place).
export const APP_NAME = "What's On";
export const APP_TAGLINE = "Exhibitions, shows & art events in London — at the places you care about.";
export const REPO = "wgates50/Whats-On2027";
export const REPO_URL = `https://github.com/${REPO}`;

/** Prefilled GitHub issue-form links (no tokens needed — you're signed in to GitHub). */
export function addEventUrl(prefill: { venue?: string; title?: string; start?: string; link?: string } = {}): string {
  const p = new URLSearchParams({ template: "add-event.yml", title: `Add event: ${prefill.title ?? ""}`.trim() });
  if (prefill.venue) p.set("venue", prefill.venue);
  if (prefill.title) p.set("event-title", prefill.title);
  if (prefill.start) p.set("start", prefill.start);
  if (prefill.link) p.set("link", prefill.link);
  return `${REPO_URL}/issues/new?${p}`;
}

export function venueRequestUrl(name = ""): string {
  const p = new URLSearchParams({ template: "venue-request.yml", title: `Venue request: ${name}`.trim() });
  if (name) p.set("name", name);
  return `${REPO_URL}/issues/new?${p}`;
}
