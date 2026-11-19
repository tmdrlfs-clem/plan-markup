"use client";

import { setNonce } from "get-nonce";

/** This document's CSP nonce, from a script Next.js rendered with it. */
export function documentNonce(doc: Document): string | undefined {
  return (doc.querySelector("script[nonce]") as HTMLScriptElement | null)?.nonce || undefined;
}

/**
 * Hands the document's CSP nonce to `get-nonce`, which react-style-singleton
 * reads when Radix dialogs and menus lock page scroll: it adds a <style> tag at
 * that moment, and without the nonce the production CSP (style-src 'self'
 * 'nonce-…') blocks it.
 *
 * The nonce is read from the page, not passed from the server: each request
 * gets a new nonce, and after a client-side navigation (sign-in → workspace)
 * the server's newest one no longer matches the CSP this document loaded with.
 * Runs during render, so it is set before any dialog can open. Renders nothing.
 */
export function StyleNonce() {
  if (typeof document !== "undefined") {
    const nonce = documentNonce(document);
    if (nonce) setNonce(nonce);
  }
  return null;
}
