"use client";

// First-use tips (UX-DR16): one dismissible inline tip the first time a user
// meets a feature (no tours). Which tips a user has seen is remembered per
// user in localStorage, like the snap toggles and the layout. Story 4.3's
// Calibrate dialog is the first user; the Tool Chest and 4541 reuse it.

import { Info, X } from "lucide-react";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import { createStore } from "zustand/vanilla";

import { IconButton } from "@/components/ui/icon-button";

/** Tip ids seen by the signed-in user. `loaded`: the user's record has been read (no tip shows before). */
export const tipsStore = createStore<{ seen: readonly string[]; loaded: boolean }>(() => ({ seen: [], loaded: false }));

const Stored = z.object({ v: z.literal(1), seen: z.array(z.string().max(64)).max(200) });

export function tipsStorageKey(userId: string): string {
  return `pm.tips.v1.${userId}`;
}

export function parseTips(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed = Stored.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.seen : [];
  } catch {
    return [];
  }
}

function localStorageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Marks tip `id` as seen (it will not show again for this user). */
export function markTipSeen(id: string): void {
  const { seen } = tipsStore.getState();
  if (!seen.includes(id)) tipsStore.setState({ seen: [...seen, id] });
}

/** Restores the user's seen tips on mount and saves every change; follows other browser tabs of the same user. */
export function useFirstUseTipsPersistence(userId: string): void {
  useLayoutEffect(() => {
    const storage = localStorageOrUndefined();
    const key = tipsStorageKey(userId);
    let raw: string | null = null;
    try {
      raw = storage?.getItem(key) ?? null;
    } catch {
      raw = null;
    }
    tipsStore.setState({ seen: parseTips(raw), loaded: true }, true);
    const unsubscribe = tipsStore.subscribe((s) => {
      try {
        storage?.setItem(key, JSON.stringify({ v: 1, seen: s.seen }));
      } catch {
        // Storage full or blocked: tips may show again.
      }
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) tipsStore.setState({ seen: parseTips(event.newValue), loaded: true }, true);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      unsubscribe();
      tipsStore.setState({ seen: [], loaded: false }, true);
    };
  }, [userId]);
}

/**
 * Whether tip `id` shows in the component calling it: the first time the
 * user meets it, for as long as that component stays mounted (it is marked
 * seen at once, so it never shows again), until dismissed.
 */
export function useFirstUseTip(id: string): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(() => {
    const { seen, loaded } = tipsStore.getState();
    return loaded && !seen.includes(id);
  });
  useLayoutEffect(() => {
    if (show) markTipSeen(id);
  }, [id, show]);
  return { show, dismiss: () => setShow(false) };
}

/** The inline tip: info icon, text and Dismiss; announced politely. */
export function FirstUseTip({ id, children }: { id: string; children: ReactNode }) {
  const { show, dismiss } = useFirstUseTip(id);
  if (!show) return null;
  return (
    <div
      role="note"
      data-testid={`tip-${id}`}
      className="mb-3 flex items-start gap-2 rounded-sm border border-border bg-surface-2 py-1.5 pl-2 pr-1 text-ws-sm text-text"
    >
      <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
      <div className="min-w-0 flex-1">{children}</div>
      <IconButton label="Dismiss tip" icon={X} size="xs" onClick={dismiss} />
    </div>
  );
}
