// Device sync: GET / PUT one document per sync code. The code is the only key (the store path is its
// SHA-256, so codes never appear in storage) — whoever has it can read and change that list.

import { createHash } from "node:crypto";
import { CODE_RE, cleanDoc } from "@/lib/syncData";
import { syncStore } from "@/lib/syncStore";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function pathFor(req: Request): string | null {
  const code = req.headers.get("x-sync-code") ?? "";
  return CODE_RE.test(code) ? `sync/${createHash("sha256").update(code).digest("hex")}.json` : null;
}

export async function GET(req: Request) {
  const path = pathFor(req);
  if (!path) return json({ error: "That isn't a sync code." }, 400);
  const store = syncStore();
  if (!store) return json({ error: "Sync isn't set up on the server yet." }, 503);
  const body = await store.read(path);
  return body ? json(JSON.parse(body)) : json({ error: "No list saved under this code yet." }, 404);
}

export async function PUT(req: Request) {
  const path = pathFor(req);
  if (!path) return json({ error: "That isn't a sync code." }, 400);
  const store = syncStore();
  if (!store) return json({ error: "Sync isn't set up on the server yet." }, 503);
  const text = await req.text();
  if (text.length > 200_000) return json({ error: "Too big." }, 413);
  let doc;
  try {
    doc = cleanDoc(JSON.parse(text));
  } catch {
    doc = null;
  }
  if (!doc) return json({ error: "That doesn't look like a list of follows." }, 400);
  await store.write(path, JSON.stringify(doc));
  return json({ ok: true, updatedAt: doc.updatedAt });
}
