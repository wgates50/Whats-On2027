// Polite HTTP fetching with robots.txt, per-host rate limiting, and fixture record/replay.
//
//   live    – fetch from the web
//   record  – fetch from the web and save every response under a fixture dir
//   replay  – serve only from a fixture dir (used by tests; no network)

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

export const USER_AGENT =
  "Mozilla/5.0 (compatible; WhatsOnLondon/0.1; personal non-commercial listings; +https://github.com/wgates50/Whats-On2027)";
const ROBOTS_TOKEN = "whatsonlondon";

export interface FetchResult {
  url: string; // final URL after redirects
  status: number;
  body: string;
  contentType: string;
}

export class BlockedError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "BlockedError";
  }
}

export interface Fetcher {
  get(url: string): Promise<FetchResult>;
  /** Number of network requests actually made (for logging). */
  requests: number;
}

type Mode = "live" | "record" | "replay";

interface FixtureIndexEntry {
  file: string;
  status: number;
  finalUrl: string;
  contentType: string;
}

const fixtureKey = (url: string) => createHash("sha1").update(url).digest("hex").slice(0, 12);

export function createFetcher(opts: { mode: Mode; fixtureDir?: string; minDelayMs?: number; timeoutMs?: number }): Fetcher {
  const { mode, fixtureDir } = opts;
  const minDelay = opts.minDelayMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const hostQueues = new Map<string, Promise<unknown>>();
  const robotsCache = new Map<string, Promise<RobotsRules>>();

  let index: Record<string, FixtureIndexEntry> = {};
  const indexPath = fixtureDir ? join(fixtureDir, "index.json") : "";
  if (mode !== "live") {
    if (!fixtureDir) throw new Error("fixtureDir required for record/replay");
    if (mode === "replay") {
      if (!existsSync(indexPath)) throw new Error(`No fixture index at ${indexPath} — record one with \`npm run fixture -- <sourceId>\``);
      index = JSON.parse(readFileSync(indexPath, "utf8"));
    } else {
      mkdirSync(fixtureDir, { recursive: true });
    }
  }

  const self: Fetcher = {
    requests: 0,
    async get(url: string): Promise<FetchResult> {
      let res: FetchResult;
      if (mode === "replay") {
        const e = index[url];
        if (!e) throw new Error(`Not in fixture: ${url}`);
        const body = gunzipSync(readFileSync(join(fixtureDir!, e.file))).toString("utf8");
        res = { url: e.finalUrl, status: e.status, contentType: e.contentType, body };
      } else {
        const u = new URL(url);
        const rules = await robotsFor(u.origin);
        if (!rules.allows(u.pathname + u.search)) {
          throw new BlockedError(`robots.txt disallows ${u.pathname}`, url);
        }
        res = await throttled(u.host, () => fetchWithRetry(url));
        if (mode === "record") {
          // Adapters see exactly what is stored, so recorded expectations replay identically.
          res = { ...res, body: slimHtml(res.body) };
          const file = fixtureKey(url) + ".html.gz";
          writeFileSync(join(fixtureDir!, file), gzipSync(res.body, { level: 9 }));
          index[url] = { file, status: res.status, finalUrl: res.url, contentType: res.contentType };
          writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
        }
      }
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw new BlockedError(`HTTP ${res.status} (site is refusing automated requests)`, url);
      }
      if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    },
  };

  function throttled<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const prev = hostQueues.get(host) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // Space requests to the same host by minDelay, whether or not they succeed.
    hostQueues.set(host, next.then(sleep(minDelay), sleep(minDelay)));
    return next;
  }

  async function fetchWithRetry(url: string, attempt = 0): Promise<FetchResult> {
    self.requests++;
    try {
      const r = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/xml,text/calendar;q=0.9,*/*;q=0.8", "accept-language": "en-GB,en;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status >= 500 && attempt < 1) {
        await sleep(3000)();
        return fetchWithRetry(url, attempt + 1);
      }
      return { url: r.url || url, status: r.status, body: await r.text(), contentType: r.headers.get("content-type") ?? "" };
    } catch (e) {
      if (attempt < 1) {
        await sleep(3000)();
        return fetchWithRetry(url, attempt + 1);
      }
      throw new Error(`Network error for ${url}: ${(e as Error).message}`);
    }
  }

  function robotsFor(origin: string): Promise<RobotsRules> {
    let p = robotsCache.get(origin);
    if (!p) {
      p = (async () => {
        try {
          const host = new URL(origin).host;
          const r = await throttled(host, () => fetchWithRetry(origin + "/robots.txt"));
          // Per RFC 9309: 4xx (except 429) means no restrictions; 5xx/429 means assume full disallow.
          if (r.status === 429 || r.status >= 500) return { allows: () => false };
          if (r.status >= 400) return { allows: () => true };
          return parseRobots(r.body, ROBOTS_TOKEN);
        } catch {
          return { allows: () => true };
        }
      })();
      robotsCache.set(origin, p);
    }
    return p;
  }

  return self;
}

/**
 * Shrink HTML for fixtures: drop executable scripts, styles, SVG and comments, but keep data
 * scripts (JSON-LD, __NEXT_DATA__, application/json) that adapters may read.
 */
export function slimHtml(html: string): string {
  return html
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (m, attrs: string) =>
      /application\/(ld\+)?json|__NEXT_DATA__/i.test(attrs) ? m : "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg></svg>")
    .replace(/<!--[\s\S]*?-->/g, "");
}

const sleep = (ms: number) => () => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- robots.txt

export interface RobotsRules {
  allows(path: string): boolean;
}

/** Minimal RFC 9309 parser: picks the group for our token (else `*`), longest match wins, Allow wins ties. */
export function parseRobots(txt: string, token: string): RobotsRules {
  type Rule = { allow: boolean; pattern: string };
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (val !== "" || key === "allow") current.rules.push({ allow: key === "allow", pattern: val });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules).filter((r) => r.pattern !== "");

  const toRe = (pattern: string) =>
    new RegExp(
      "^" +
        pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\\\$$/, "$"),
    );
  const compiled = rules.map((r) => ({ ...r, re: toRe(r.pattern), len: r.pattern.length }));

  return {
    allows(path: string) {
      let best: { allow: boolean; len: number } | null = null;
      for (const r of compiled) {
        if (r.re.test(path) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
      }
      return best ? best.allow : true;
    },
  };
}
