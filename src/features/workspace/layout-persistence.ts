import { z } from "zod";

import { LEFT_PANEL_IDS, type LeftPanelId } from "./panel-registry";

export const LEFT_SIZE = { min: 220, max: 420, default: 280 } as const;
export const BOTTOM_SIZE = { min: 120, max: 480, default: 200 } as const;

export interface WorkspaceLayout {
  left: { collapsed: boolean; size: number; active: LeftPanelId };
  bottom: { collapsed: boolean; size: number };
}

export interface Viewport {
  width: number;
  height: number;
}

/** Panels open from 1440 px wide; the Markups list also needs 800 px of height (UX-DR37). */
export function defaultLayout({ width, height }: Viewport): WorkspaceLayout {
  const wide = width >= 1440;
  return {
    left: { collapsed: !wide, size: LEFT_SIZE.default, active: "tool-chest" },
    bottom: { collapsed: !wide || height < 800, size: BOTTOM_SIZE.default },
  };
}

/** What the server renders before the client restores the stored layout. */
export const SERVER_LAYOUT: WorkspaceLayout = {
  left: { collapsed: true, size: LEFT_SIZE.default, active: "tool-chest" },
  bottom: { collapsed: true, size: BOTTOM_SIZE.default },
};

export function clampSize(size: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(size)));
}

const StoredLayout = z.object({
  v: z.literal(1),
  left: z.object({
    collapsed: z.boolean(),
    size: z.number().finite(),
    active: z.string(),
  }),
  bottom: z.object({
    collapsed: z.boolean(),
    size: z.number().finite(),
  }),
});

export function storageKey(userId: string): string {
  return `pm.workspace.layout.v1.${userId}`;
}

/** Parses a stored value; anything unusable gives null so the caller uses the defaults. */
export function parseLayout(raw: string | null, fallback: WorkspaceLayout): WorkspaceLayout | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = StoredLayout.safeParse(json);
  if (!parsed.success) return null;
  const { left, bottom } = parsed.data;
  const active = (LEFT_PANEL_IDS as readonly string[]).includes(left.active)
    ? (left.active as LeftPanelId)
    : fallback.left.active;
  return {
    left: { collapsed: left.collapsed, size: clampSize(left.size, LEFT_SIZE), active },
    bottom: { collapsed: bottom.collapsed, size: clampSize(bottom.size, BOTTOM_SIZE) },
  };
}

export function serializeLayout(layout: WorkspaceLayout): string {
  return JSON.stringify({ v: 1, left: layout.left, bottom: layout.bottom });
}

/** Reads the user's layout; storage errors (private mode, blocked storage) fall back to defaults. */
export function loadLayout(storage: Storage | undefined, userId: string, viewport: Viewport): WorkspaceLayout {
  const fallback = defaultLayout(viewport);
  try {
    return parseLayout(storage?.getItem(storageKey(userId)) ?? null, fallback) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveLayout(storage: Storage | undefined, userId: string, layout: WorkspaceLayout): void {
  try {
    storage?.setItem(storageKey(userId), serializeLayout(layout));
  } catch {
    // Storage full or blocked: the layout simply is not remembered.
  }
}
