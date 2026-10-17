"use client";

// Auth pages: rendered inside the (auth) layout's Daylight <main>, so it
// renders a <div> and omits the markups line (founder decision 5).
import { RouteErrorBoundary } from "@/components/route-error-boundary";

export default function RouteError({ error }: { error: unknown; retry: () => void }) {
  return <RouteErrorBoundary error={error} variant="auth" as="div" />;
}
