"use client";

import { CircleX, RotateCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/** A digest Next.js generated (a hash). Anything else is never rendered. */
const SAFE_DIGEST_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeDigest(value: unknown): value is string {
  return typeof value === "string" && SAFE_DIGEST_RE.test(value);
}

export type RouteErrorScreenProps = {
  /** "auth" drops the markups line: there are no markups on auth pages. */
  variant?: "app" | "auth";
  /** The landmark to render. "div" inside layouts that already render a <main>. */
  as?: "main" | "div";
  digest?: string | null;
  onReload: () => void;
};

/**
 * The route error screen (UX-DR30): what happened, what is safe, one action.
 * Error codes only in Details. Never renders the error message.
 */
export function RouteErrorScreen({ variant = "app", as = "main", digest, onReload }: RouteErrorScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const Landmark = as;
  const safeDigest = isSafeDigest(digest) ? digest : null;
  return (
    <Landmark className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded border border-border bg-surface-1 p-8 shadow-1">
        <div className="flex items-center gap-2">
          <CircleX aria-hidden="true" className="size-5 shrink-0 text-danger" />
          <h1 ref={headingRef} tabIndex={-1} className="text-ad-xl font-semibold outline-none">
            Something stopped working
          </h1>
        </div>
        {variant === "app" ? <p className="text-ad-sm">Your markups are saved locally.</p> : null}
        <div>
          <Button variant="primary" size="md" onClick={onReload}>
            <RotateCw aria-hidden="true" className="size-4" />
            Reload
          </Button>
        </div>
        {safeDigest ? (
          <details className="text-ad-sm text-muted">
            <summary className="cursor-pointer select-none">Details</summary>
            <p className="mt-2">Error ID {safeDigest}</p>
          </details>
        ) : null}
      </div>
    </Landmark>
  );
}
