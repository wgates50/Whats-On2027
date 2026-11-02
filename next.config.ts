import type { NextConfig } from "next";

const config: NextConfig = {
  // Fully static site: rebuilt (by Vercel) whenever the daily scrape commits new data.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default config;
