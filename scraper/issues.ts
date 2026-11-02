// Turn data/health.json into GitHub issues (run by the daily workflow; no AI involved).
//
//  • A broken source gets one issue "Source broken: <id>" (labels: broken-source + status).
//      - invalid (dates/titles don't parse) is reported on the first bad run
//      - everything else (empty, dropped, errors, blocks) after 2 bad runs in a row — sites
//        occasionally serve an empty or odd page once; the source keeps its previous events meanwhile
//    The issue body is refreshed each run; it is closed automatically when the source recovers.
//  • Unknown venue names coming from aggregators are collected in one rolling issue
//    (label: venue-aliases) so the maintainer can add aliases or venues.
//
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY (both provided by GitHub Actions).

import { loadHealth, loadSources } from "./config.ts";

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!token || !repo) {
  console.log("GITHUB_TOKEN/GITHUB_REPOSITORY not set — skipping issue sync.");
  process.exit(0);
}

async function gh<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 404) throw new Error(`${method} ${path}: HTTP ${r.status} ${await r.text()}`);
  return (r.status === 204 || r.status === 404 ? null : await r.json()) as T;
}

const LABELS: Record<string, string> = {
  "broken-source": "d73a4a",
  "venue-aliases": "fbca04",
  blocked: "5319e7",
  error: "b60205",
  empty: "e99695",
  dropped: "f9d0c4",
  invalid: "c5def5",
  "needs-you": "000000",
};

async function ensureLabels() {
  for (const [name, color] of Object.entries(LABELS)) {
    const existing = await gh(`GET`, `/repos/${repo}/labels/${encodeURIComponent(name)}`);
    if (!existing) await gh("POST", `/repos/${repo}/labels`, { name, color });
  }
}

interface Issue {
  number: number;
  title: string;
  labels: { name: string }[];
  body: string | null;
}

async function openIssues(label: string): Promise<Issue[]> {
  return (await gh<Issue[]>("GET", `/repos/${repo}/issues?state=open&labels=${label}&per_page=100`)) ?? [];
}

const health = loadHealth();
const sources = new Map(loadSources().map((s) => [s.id, s]));
await ensureLabels();

const open = await openIssues("broken-source");
const titleFor = (id: string) => `Source broken: ${id}`;

for (const [id, h] of Object.entries(health.sources)) {
  const existing = open.find((i) => i.title === titleFor(id));
  const report = h.status !== "ok" && (h.status === "invalid" || h.consecutiveFailures >= 2);
  if (h.status === "ok") {
    if (existing) {
      await gh("POST", `/repos/${repo}/issues/${existing.number}/comments`, { body: `✅ Healthy again: ${h.count} events on ${h.checkedAt.slice(0, 10)}.` });
      await gh("PATCH", `/repos/${repo}/issues/${existing.number}`, { state: "closed", state_reason: "completed" });
      console.log(`closed #${existing.number} (${id})`);
    }
    continue;
  }
  if (!report) continue;
  const source = sources.get(id);
  const body = [
    `**Status:** \`${h.status}\` · ${h.consecutiveFailures} bad run(s) in a row · last OK: ${h.lastOk?.slice(0, 10) ?? "never"} (${h.lastOkCount ?? 0} events)`,
    ``,
    `**Message:** ${h.message ?? "—"}`,
    ...(h.warnings?.length ? [``, `**Warnings:**`, ...h.warnings.map((w) => `- ${w}`)] : []),
    ``,
    h.status === "blocked"
      ? `> ⛔ The site is refusing automated requests or robots.txt disallows us. **Do not try to get around this.** Mark the venue \`manualOnly\` (or find an official feed/API the site offers), and disable the source.`
      : `> Fix: run \`npm run discover -- <listing url>\` to see current markup, update the source in \`data/sources.json\`, check with \`npm run scrape -- --only ${id} --dry\`, then \`npm run fixture -- ${id}\` and \`npm test\`.`,
    ``,
    `<details><summary>Current config</summary>`,
    ``,
    "```json",
    JSON.stringify(source ?? { id, note: "source no longer configured" }, null, 2),
    "```",
    `</details>`,
    ``,
    `_Updated automatically by the daily scrape (${h.checkedAt}). Closed automatically when the source is healthy again._`,
  ].join("\n");
  const labels = ["broken-source", h.status, ...(h.consecutiveFailures >= 7 ? ["needs-you"] : [])];
  if (existing) {
    await gh("PATCH", `/repos/${repo}/issues/${existing.number}`, { body, labels });
    console.log(`updated #${existing.number} (${id}: ${h.status})`);
  } else {
    const created = await gh<Issue>("POST", `/repos/${repo}/issues`, { title: titleFor(id), body, labels });
    console.log(`opened #${created.number} (${id}: ${h.status})`);
  }
}

// Close issues for sources that no longer exist.
for (const i of open) {
  const id = i.title.replace(/^Source broken: /, "");
  if (!health.sources[id] && !sources.has(id)) {
    await gh("PATCH", `/repos/${repo}/issues/${i.number}`, { state: "closed", state_reason: "not_planned" });
  }
}

// Rolling issue for unknown venue names from aggregators.
const unmatched: [string, string, number][] = [];
for (const [id, h] of Object.entries(health.sources))
  for (const [name, n] of Object.entries(h.unmatchedVenues ?? {}))
    if (!/^(online|offsite|\(no venue given\)|no venue|various|tbc|tba)$/i.test(name)) unmatched.push([id, name, n]);
const [aliasIssue] = await openIssues("venue-aliases");
if (unmatched.length) {
  const body = [
    `Aggregator sources mention venues we can't match to \`data/venues.json\`. Events at these places are currently dropped.`,
    ``,
    `For each: if it's a London venue worth listing, add it to \`data/venues.json\` (or add the name to an existing venue's \`aliases\`). If not, ignore it.`,
    ``,
    `| source | venue name | events |`,
    `|---|---|---|`,
    ...unmatched.sort((a, b) => b[2] - a[2]).map(([s, n, c]) => `| ${s} | ${n.replace(/\|/g, "/")} | ${c} |`),
    ``,
    `_Updated automatically by the daily scrape (${health.checkedAt})._`,
  ].join("\n");
  if (aliasIssue) await gh("PATCH", `/repos/${repo}/issues/${aliasIssue.number}`, { body });
  else await gh("POST", `/repos/${repo}/issues`, { title: "Unknown venue names from aggregators", body, labels: ["venue-aliases"] });
} else if (aliasIssue) {
  await gh("PATCH", `/repos/${repo}/issues/${aliasIssue.number}`, { state: "closed", state_reason: "completed" });
}
console.log("issue sync done");
