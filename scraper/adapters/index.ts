import type { AdapterConfig } from "../../lib/types.ts";
import type { Fetcher } from "../fetcher.ts";
import type { RawEvent } from "../extract.ts";
import { runPages } from "./pages.ts";
import { runIcs } from "./ics.ts";

export interface AdapterContext {
  fetcher: Fetcher;
  today: string; // YYYY-MM-DD London
  log: (msg: string) => void;
  /** Used when recording fixtures, to keep them small. */
  limits?: { maxPages?: number; maxLinks?: number };
}

export interface AdapterResult {
  events: RawEvent[];
  warnings: string[];
  /** Detail pages that had no parseable dates (a sign the selectors are wrong). */
  skippedNoDates: number;
  linksFound: number;
}

export type CustomAdapter = (ctx: AdapterContext, options: Record<string, unknown>) => Promise<AdapterResult>;

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
