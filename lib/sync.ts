"use client";

// Keeps follows, people and saved events the same on all your devices. Each device that has the sync
// code pushes its lists to /api/sync when they change and pulls on opening the app. If both sides
// changed since they last agreed, the lists are merged (nothing you followed anywhere is lost; an
// unfollow on one device can come back if the other changed at the same time).

import { useSyncExternalStore } from "react";
import { mergeDocs, newCode, type SyncDoc } from "./syncData";
import { laterDay, onLocalChange, readPrefs, writeSyncedPrefs } from "./store";

export interface SyncState {
  code: string;
  /** The server's version (its updatedAt) this device last agreed with. */
  agreedAt?: string;
  /** Changes made on this device, and how many of them the server has (counts, not clocks: devices' clocks differ). */
  rev?: number;
  pushedRev?: number;
  /** Last time a sync round-trip worked, and the last problem, for the Sync page. */
  lastOk?: string;
  problem?: string;
}

const KEY = "whatson:sync";
const listeners = new Set<() => void>();
let cached: SyncState | null | undefined;

function readState(): SyncState | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as SyncState) : null;
  } catch {
    cached = null;
  }
  return cached;
}
function writeState(s: SyncState | null) {
  cached = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: sync just won't persist */
  }
  listeners.forEach((l) => l());
}
const patch = (p: Partial<SyncState>) => {
  const s = readState();
  if (s) writeState({ ...s, ...p });
};

export function useSyncState(): SyncState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readState,
    () => null,
  );
}

async function call(method: "GET" | "PUT", code: string, doc?: SyncDoc): Promise<Response> {
  return fetch("/api/sync/", {
    method,
    headers: { "x-sync-code": code, ...(doc ? { "content-type": "application/json" } : {}) },
    body: doc ? JSON.stringify(doc) : undefined,
    cache: "no-store",
  });
}

type Lists = { follows: string[]; people: string[]; saved: string[]; seenUpTo?: string };
const docOf = (p: Lists, updatedAt: string): SyncDoc => ({
  v: 1,
  updatedAt,
  follows: p.follows,
  people: p.people,
  saved: p.saved,
  ...(p.seenUpTo ? { seenUpTo: p.seenUpTo } : {}),
});

let inFlight: Promise<void> | null = null;

/** One round-trip with the server. Safe to call often; overlapping calls share one. */
export function syncNow(): Promise<void> {
  inFlight ??= run().finally(() => (inFlight = null));
  return inFlight;
}

async function run(): Promise<void> {
  const s = readState();
  if (!s) return;
  const local = readPrefs();
  const rev = s.rev ?? 0;
  const now = () => new Date().toISOString();
  // "Seen up to" only moves forward: a device on an older version may not send it at all.
  const lists = (p: Lists) => ({ follows: p.follows, people: p.people, saved: p.saved, seenUpTo: laterDay(local.seenUpTo, p.seenUpTo) || undefined });
  try {
    const res = await call("GET", s.code);
    if (res.status === 404) {
      // First device on this code: the server takes what's here.
      const doc = docOf(local, now());
      await put(s.code, doc);
      patch({ agreedAt: doc.updatedAt, pushedRev: rev, lastOk: now(), problem: undefined });
      return;
    }
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    const remote = (await res.json()) as SyncDoc;
    const remoteChanged = remote.updatedAt !== s.agreedAt;
    // Joining with lists of its own counts as a change here, so they're merged rather than replaced.
    const joining = s.agreedAt === undefined && local.follows.length + local.people.length + local.saved.length > 0;
    const localChanged = rev > (s.pushedRev ?? 0) || joining;
    let agreedAt = s.agreedAt;
    if (remoteChanged && localChanged) {
      const merged = mergeDocs(local, remote, now());
      writeSyncedPrefs({ ...local, ...lists(merged), updatedAt: merged.updatedAt });
      await put(s.code, merged);
      agreedAt = merged.updatedAt;
    } else if (remoteChanged) {
      writeSyncedPrefs({ ...local, ...lists(remote), updatedAt: remote.updatedAt });
      agreedAt = remote.updatedAt;
    } else if (localChanged) {
      const doc = docOf(local, now());
      await put(s.code, doc);
      agreedAt = doc.updatedAt;
    }
    patch({ agreedAt, pushedRev: rev, lastOk: now(), problem: undefined });
  } catch (e) {
    patch({ problem: navigator.onLine === false ? "You’re offline — it’ll sync when you’re back." : (e as Error).message });
  }
}

async function put(code: string, doc: SyncDoc) {
  const res = await call("PUT", code, doc);
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
}

/** Start syncing this device under a new code. */
export async function turnOnSync(): Promise<string> {
  const code = newCode((n) => crypto.getRandomValues(new Uint8Array(n)));
  writeState({ code });
  await syncNow();
  return code;
}

/** Join the code from another device: what's here and what's there are merged. */
export async function joinSync(code: string): Promise<void> {
  writeState({ code });
  await syncNow();
}

export function turnOffSync() {
  writeState(null);
}

/** App-wide: sync on open, when the app comes back to the foreground, and shortly after any change. */
export function startSyncAgent(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 1500);
  };
  void syncNow();
  const onVisible = () => document.visibilityState === "visible" && void syncNow();
  document.addEventListener("visibilitychange", onVisible);
  const off = onLocalChange(() => {
    const s = readState();
    if (!s) return;
    patch({ rev: (s.rev ?? 0) + 1 });
    soon();
  });
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    off();
  };
}
