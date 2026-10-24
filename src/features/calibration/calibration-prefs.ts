// The Calibrate dialog's display unit and precision defaults (Story 4.3 AC 3):
// remembered per user in localStorage, like the snap toggles.

import { useLayoutEffect } from "react";
import { z } from "zod";
import { createStore } from "zustand/vanilla";

import { DISPLAY_UNITS, PRECISIONS, type DisplayUnit, type Precision } from "@/core/calibration/calibration";
import { precisionsFor } from "@/core/calibration/units";

export type CalibrationPrefs = { unit: DisplayUnit; precision: Precision };

/** Millimetres, whole (the drawings are metric: NZ). */
export const DEFAULT_CALIBRATION_PREFS: CalibrationPrefs = { unit: "mm", precision: "0" };

export const calibrationPrefs = createStore<CalibrationPrefs>(() => DEFAULT_CALIBRATION_PREFS);

const Stored = z.object({ v: z.literal(1), unit: z.enum(DISPLAY_UNITS), precision: z.enum(PRECISIONS) });

export function calibrationPrefsKey(userId: string): string {
  return `pm.calibration.v1.${userId}`;
}

/** A stored value, or null when missing or unusable; a precision the unit cannot show falls back to its first. */
export function parseCalibrationPrefs(raw: string | null): CalibrationPrefs | null {
  if (raw === null) return null;
  try {
    const parsed = Stored.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { unit, precision } = parsed.data;
    return { unit, precision: precisionsFor(unit).includes(precision) ? precision : precisionsFor(unit)[0] };
  } catch {
    return null;
  }
}

/** Remembers the unit and precision a calibration was applied with. */
export function setCalibrationPrefs(prefs: CalibrationPrefs): void {
  const current = calibrationPrefs.getState();
  if (current.unit !== prefs.unit || current.precision !== prefs.precision) calibrationPrefs.setState(prefs, true);
}

function localStorageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Restores the user's defaults on mount and saves every change (the workspace shell). */
export function useCalibrationPrefsPersistence(userId: string): void {
  useLayoutEffect(() => {
    const storage = localStorageOrUndefined();
    const key = calibrationPrefsKey(userId);
    let raw: string | null = null;
    try {
      raw = storage?.getItem(key) ?? null;
    } catch {
      raw = null;
    }
    calibrationPrefs.setState(parseCalibrationPrefs(raw) ?? DEFAULT_CALIBRATION_PREFS, true);
    const unsubscribe = calibrationPrefs.subscribe((s) => {
      try {
        storage?.setItem(key, JSON.stringify({ v: 1, ...s }));
      } catch {
        // Storage full or blocked: the defaults are simply not remembered.
      }
    });
    return unsubscribe;
  }, [userId]);
}
