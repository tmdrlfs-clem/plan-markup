"use client";

// Workspace pages (Blueprint, inherited from <html>).
import { RouteErrorBoundary } from "@/components/route-error-boundary";

export default function RouteError({ error }: { error: unknown; retry: () => void }) {
  return <RouteErrorBoundary error={error} />;
}
