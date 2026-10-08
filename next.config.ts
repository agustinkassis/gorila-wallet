import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the desktop app (scripts/desktop.mjs) ships the self-contained server
  output: process.env.STANDALONE ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
