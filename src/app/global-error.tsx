"use client";

// Replaces the root layout when it fails, so it renders its own document and
// imports the global styles itself (global-error does not get the root layout's).
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import "./globals.css";

export default function GlobalError({ error }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" data-theme="blueprint" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-surface-0 text-text font-sans">
        <title>Plan Markup</title>
        <RouteErrorBoundary error={error} />
      </body>
    </html>
  );
}
