import type { NextConfig } from "next";

const config: NextConfig = {
  // Pages are all prerendered (rebuilt by Vercel whenever the daily scrape commits new data); the one
  // server route is /api/sync, which keeps follows and saved events in step across your devices.
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default config;
