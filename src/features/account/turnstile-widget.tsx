"use client";

import { useEffect, useRef } from "react";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Turnstile = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: "auto" | "light" | "dark";
      callback?: () => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;

/** Loads Cloudflare's script once. A script added by our nonced bundle is allowed by 'strict-dynamic'. */
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => {
      loading = null;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * The Turnstile check (Story 10.1). Rendered inside the form, it adds the
 * hidden `cf-turnstile-response` field. Tokens are single-use: the form
 * remounts this (new `key`) after each submit.
 */
export function TurnstileWidget({ siteKey, onReady }: { siteKey: string; onReady?: (ready: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  });
  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((t) => {
        if (cancelled || !ref.current) return;
        id = t.render(ref.current, {
          sitekey: siteKey,
          theme: "dark",
          callback: () => readyRef.current?.(true),
          "expired-callback": () => readyRef.current?.(false),
          "error-callback": () => readyRef.current?.(false),
        });
      })
      .catch(() => {
        // The server rejects the submit without a token and says why.
      });
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey]);
  return <div ref={ref} data-testid="turnstile" className="min-h-[65px]" />;
}
