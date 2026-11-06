// Server-side storage for device sync: one small JSON document per sync code, in a private Vercel
// Blob store (BLOB_READ_WRITE_TOKEN is added when the store is connected to the project). For local
// testing, SYNC_DEV_DIR points at a folder instead. No store → sync reports "not set up".

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { get, put } from "@vercel/blob";

export interface SyncStore {
  read(path: string): Promise<string | null>;
  write(path: string, body: string): Promise<void>;
}

export function syncStore(): SyncStore | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      async read(path) {
        const r = await get(path, { access: "private", useCache: false });
        return r ? await new Response(r.stream).text() : null;
      },
      async write(path, body) {
        await put(path, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
      },
    };
  }
  const dir = process.env.SYNC_DEV_DIR;
  if (dir) {
    const file = (path: string) => join(dir, path.replace(/\//g, "_"));
    return {
      async read(path) {
        return readFile(file(path), "utf8").catch(() => null);
      },
      async write(path, body) {
        await mkdir(dir, { recursive: true });
        await writeFile(file(path), body);
      },
    };
  }
  return null;
}
