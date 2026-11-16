"use client";

// Company pages (Daylight, set by the company layout).
import { RouteErrorBoundary } from "@/components/route-error-boundary";

export default function RouteError({ error }: { error: unknown; retry: () => void }) {
  return <RouteErrorBoundary error={error} />;
}
