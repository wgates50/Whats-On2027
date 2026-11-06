"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrefs, useHydrated } from "@/lib/store";
import { joinSync, syncNow, turnOffSync, turnOnSync, useSyncState } from "@/lib/sync";
import { normaliseCode } from "@/lib/syncData";
import { whenInstant, londonToday } from "@/lib/when";

/** Turn sync on, join another device's code, or see how it's going. */
export function SyncView() {
  const hydrated = useHydrated();
  const sync = useSyncState();
  const { prefs } = usePrefs();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [today, setToday] = useState("");
  useEffect(() => setToday(londonToday()), []);
  // /sync/?code=XXXX-XXXX-XXXX fills the box (handy from a link; on an iPhone home-screen app, type it).
  useEffect(() => {
    const c = new URLSearchParams(location.search).get("code");
    if (c) setInput(c);
  }, []);

  if (!hydrated) return <header className="masthead" aria-busy="true" />;

  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const counts = `${n(prefs.follows.length, "place", "places")}, ${n(prefs.people.length, "person", "people")} and ${prefs.saved.length} saved`;
  const code = normaliseCode(input);
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!sync) return;
    try {
      await navigator.clipboard.writeText(sync.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* no clipboard: the code is on screen */
    }
  };

  return (
    <>
      <header className="masthead">
        <p className="kicker">
          <span className="kicker__dot" /> Sync
        </p>
        <h1 className="dateline">
          <em>{sync ? "In step" : "Same lists"}</em> {sync ? "across your devices" : "on every device"}
        </h1>
      </header>

      {!sync ? (
        <>
          <p className="sync__lead">
            Your places, people and saved events live on this device ({counts}). Turn on sync to keep them the same on your phone and laptop — no
            account, just a code.
          </p>

          <section className="section">
            <div className="section-h">
              <h2>Start here</h2>
            </div>
            <p className="row__note">On the device with your follows (say, your laptop):</p>
            <button className="follow follow--big" disabled={busy} onClick={() => act(turnOnSync)}>
              <span>Turn on sync</span>
            </button>
          </section>

          <section className="section">
            <div className="section-h">
              <h2>Already have a code?</h2>
            </div>
            <p className="row__note">Enter the code from your other device. What’s here and what’s there are combined.</p>
            <form
              className="sync__join"
              onSubmit={(e) => {
                e.preventDefault();
                if (code) void act(() => joinSync(code));
              }}
            >
              <input
                className="sync__input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-label="Sync code"
              />
              <button className="follow" type="submit" disabled={!code || busy}>
                <span>Join</span>
              </button>
            </form>
            {input && !code && <p className="row__note">That doesn’t look like a code yet — it’s 12 letters and numbers.</p>}
          </section>
        </>
      ) : (
        <>
          <section className="section">
            <div className="section-h">
              <h2>Your sync code</h2>
            </div>
            <p className="sync__code" aria-label="Sync code">
              {sync.code}
            </p>
            <p className="row__note">
              On your other device, open the app, go to Saved → Sync with your other devices, and enter this code. Keep it to yourself: anyone with it can
              see and change your lists.
            </p>
            <div className="row__actions">
              <button onClick={copy}>{copied ? "Copied" : "Copy code"}</button>
              <button disabled={busy} onClick={() => act(syncNow)}>
                Sync now
              </button>
            </div>
          </section>

          <p className={`nudge${sync.problem ? " nudge--problem" : ""}`}>
            {sync.problem
              ? `Couldn’t sync: ${sync.problem}`
              : sync.lastOk && today
                ? `Synced ${whenInstant(sync.lastOk, today)} · ${counts}.`
                : busy
                  ? "Syncing…"
                  : `Waiting to sync · ${counts}.`}
          </p>

          <p className="colophon">
            <button
              className="link-button"
              onClick={() => {
                if (confirm("Stop syncing this device? Your lists stay here; other devices keep syncing with each other.")) turnOffSync();
              }}
            >
              Turn off sync on this device
            </button>
          </p>
        </>
      )}

      <p className="colophon">
        Lists are stored privately under your code (no name or email). <Link href="/saved/">Back to Saved</Link>
      </p>
    </>
  );
}
