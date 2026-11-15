"use client";

// Admin pages (Daylight, set by the admin layout).
import { RouteErrorBoundary } from "@/components/route-error-boundary";

export default function RouteError({ error }: { error: unknown; retry: () => void }) {
  return <RouteErrorBoundary error={error} />;
}
