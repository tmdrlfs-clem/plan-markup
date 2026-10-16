import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents / partialPrefetching from the scaffold defaults are off:
  // cookie-based Supabase auth (Story 1.5) reads request data in layouts, and the
  // workspace is client-heavy. Revisit for the static marketing site (Epic 13).
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
