"use client";

import { useEffect } from "react";
import { startSyncAgent } from "@/lib/sync";

/** Mounted once in the layout: keeps this device's lists in step with your others (if sync is on). */
export function SyncAgent() {
  useEffect(() => startSyncAgent(), []);
  return null;
}
