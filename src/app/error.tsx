"use client";

// Catches errors below the root layout, including those thrown in nested
// layouts such as (workspace)/layout.tsx (a segment's error.tsx does not wrap
// its own layout).
import { RouteErrorBoundary } from "@/components/route-error-boundary";

export default function RouteError({ error }: { error: unknown; retry: () => void }) {
  return <RouteErrorBoundary error={error} />;
}
