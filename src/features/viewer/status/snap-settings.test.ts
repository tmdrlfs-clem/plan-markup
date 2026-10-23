// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SNAP,
  loadSnap,
  parseSnap,
  saveSnap,
  setSnap,
  snapSettings,
  snapStorageKey,
  useSnapSettingsPersistence,
} from "./snap-settings";

afterEach(() => {
  snapSettings.setState(DEFAULT_SNAP, true);
  localStorage.clear();
});

describe("snap settings", () => {
  it("defaults to content and markup on, grid off; setSnap changes one toggle", () => {
    expect(snapSettings.getState()).toEqual({ content: true, markup: true, grid: false });
    setSnap("grid", true);
    setSnap("content", false);
    expect(snapSettings.getState()).toEqual({ content: false, markup: true, grid: true });
  });

  it("parses only its own stored shape", () => {
    expect(parseSnap(null)).toBeNull();
    expect(parseSnap("not json")).toBeNull();
    expect(parseSnap(JSON.stringify({ v: 2, content: true, markup: true, grid: true }))).toBeNull();
    expect(parseSnap(JSON.stringify({ v: 1, content: false, markup: true, grid: true, extra: 1 }))).toEqual({ content: false, markup: true, grid: true });
  });

  it("is stored per user, and storage errors fall back to the defaults", () => {
    saveSnap(localStorage, "u1", { content: false, markup: false, grid: true });
    expect(loadSnap(localStorage, "u1")).toEqual({ content: false, markup: false, grid: true });
    expect(loadSnap(localStorage, "u2")).toEqual(DEFAULT_SNAP);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } } as unknown as Storage;
    expect(loadSnap(broken, "u1")).toEqual(DEFAULT_SNAP);
    expect(() => saveSnap(broken, "u1", DEFAULT_SNAP)).not.toThrow();
    expect(loadSnap(undefined, "u1")).toEqual(DEFAULT_SNAP);
  });

  it("the persistence hook restores the user's toggles and saves each change", () => {
    localStorage.setItem(snapStorageKey("me"), JSON.stringify({ v: 1, content: false, markup: true, grid: true }));
    const { unmount } = renderHook(() => useSnapSettingsPersistence("me"));
    expect(snapSettings.getState()).toEqual({ content: false, markup: true, grid: true });
    setSnap("markup", false);
    expect(JSON.parse(localStorage.getItem(snapStorageKey("me"))!)).toEqual({ v: 1, content: false, markup: false, grid: true });
    unmount();
    setSnap("grid", false);
    expect(JSON.parse(localStorage.getItem(snapStorageKey("me"))!).grid).toBe(true); // no longer saved
  });

  it("another user's workspace gets that user's toggles, never the previous user's (sign-out / sign-in)", () => {
    saveSnap(localStorage, "a", { content: false, markup: false, grid: true });
    const { rerender, unmount } = renderHook(({ id }) => useSnapSettingsPersistence(id), { initialProps: { id: "a" } });
    expect(snapSettings.getState()).toEqual({ content: false, markup: false, grid: true });
    rerender({ id: "b" });
    expect(snapSettings.getState()).toEqual(DEFAULT_SNAP);
    expect(localStorage.getItem(snapStorageKey("b"))).toBeNull(); // nothing of a's saved under b
    setSnap("grid", true);
    rerender({ id: "a" });
    expect(snapSettings.getState()).toEqual({ content: false, markup: false, grid: true });
    expect(loadSnap(localStorage, "b")).toEqual({ ...DEFAULT_SNAP, grid: true });
    unmount();
  });

  it("follows a change saved by another browser tab of the same user, ignores other keys (review R6)", () => {
    const { unmount } = renderHook(() => useSnapSettingsPersistence("me"));
    const other = JSON.stringify({ v: 1, content: false, markup: true, grid: true });
    window.dispatchEvent(new StorageEvent("storage", { key: snapStorageKey("someone"), newValue: other }));
    expect(snapSettings.getState()).toEqual(DEFAULT_SNAP);
    window.dispatchEvent(new StorageEvent("storage", { key: snapStorageKey("me"), newValue: other }));
    expect(snapSettings.getState()).toEqual({ content: false, markup: true, grid: true });
    window.dispatchEvent(new StorageEvent("storage", { key: snapStorageKey("me"), newValue: null })); // cleared
    expect(snapSettings.getState()).toEqual(DEFAULT_SNAP);
    unmount();
    window.dispatchEvent(new StorageEvent("storage", { key: snapStorageKey("me"), newValue: other }));
    expect(snapSettings.getState()).toEqual(DEFAULT_SNAP); // no listener left
  });
});
