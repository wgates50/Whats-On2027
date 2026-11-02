import type { AdapterConfig } from "../../lib/types.ts";
import type { Fetcher } from "../fetcher.ts";
import type { RawEvent } from "../extract.ts";
import { runPages } from "./pages.ts";
import { runIcs } from "./ics.ts";

/** What a detail page said last time we fetched it (null = it had no usable event). */
export interface CachedDetail {
  raw: RawEvent | null;
  at: string; // YYYY-MM-DD fetched
}
export type DetailCache = Map<string, CachedDetail>;

export interface AdapterContext {
  fetcher: Fetcher;
  today: string; // YYYY-MM-DD London
  log: (msg: string) => void;
  /** Used when recording fixtures, to keep them small. */
  limits?: { maxPages?: number; maxLinks?: number };
  /** Detail-page cache for sources with `cacheDays` (loaded/saved by run.ts; absent in tests). */
  cache?: DetailCache;
  /** Epoch ms after which adapters stop fetching detail pages and return what they have. */
  deadline?: number;
}

export interface AdapterResult {
  events: RawEvent[];
  warnings: string[];
  /** Detail pages that had no parseable dates (a sign the selectors are wrong). */
  skippedNoDates: number;
  linksFound: number;
}

export type CustomAdapter = (ctx: AdapterContext, options: Record<string, unknown>) => Promise<AdapterResult>;

/** Thrown by API adapters when their key isn't configured: the source is skipped, not broken. */
export class MissingKeyError extends Error {
  constructor(readonly envVar: string) {
    super(`${envVar} is not set — add it as a GitHub Actions secret (see README) to enable this source`);
    this.name = "MissingKeyError";
  }
}

export async function runAdapter(cfg: AdapterConfig, ctx: AdapterContext): Promise<AdapterResult> {
  switch (cfg.type) {
    case "pages":
      return runPages(cfg, ctx);
    case "ics":
      return runIcs(cfg, ctx);
    case "custom": {
      if (!/^[a-z0-9-]+$/.test(cfg.module)) throw new Error(`Invalid custom module name: ${cfg.module}`);
      const mod = (await import(`./custom/${cfg.module}.ts`)) as { default: CustomAdapter };
      return mod.default(ctx, cfg.options ?? {});
    }
  }
}
