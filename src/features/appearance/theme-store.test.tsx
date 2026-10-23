// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ setTheme: vi.fn() }));

import { toastStore } from "@/components/ui/toast-store";

import { THEME_STORAGE_KEY, chooseTheme, readStoredTheme, storeTheme, themeStore, useWorkspaceTheme } from "./theme-store";

const html = () => document.documentElement.getAttribute("data-theme");

beforeEach(() => {
  document.documentElement.setAttribute("data-theme", "blueprint");
  themeStore.setState({ theme: null });
  localStorage.clear();
  toastStore.setState({ visible: [], queue: [] });
});
afterEach(() => vi.restoreAllMocks());

describe("useWorkspaceTheme", () => {
  it("applies the profile's theme to <html>, follows a choice, and puts Blueprint back on unmount", () => {
    const { result, unmount } = renderHook(() => useWorkspaceTheme("daylight"));
    expect(result.current).toBe("daylight");
    expect(html()).toBe("daylight");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("daylight"); // the browser's copy
    act(() => themeStore.setState({ theme: "contrast" }));
    expect(result.current).toBe("contrast");
    expect(html()).toBe("contrast");
    unmount();
    expect(html()).toBe("blueprint");
    expect(themeStore.getState().theme).toBeNull(); // the next user starts from their own profile
  });

  it("without a profile value uses the browser's last choice, else Blueprint", () => {
    storeTheme("contrast");
    const { result, unmount } = renderHook(() => useWorkspaceTheme(null));
    expect(result.current).toBe("contrast");
    unmount();
    localStorage.clear();
    const second = renderHook(() => useWorkspaceTheme(null));
    expect(second.result.current).toBe("blueprint");
  });
});

describe("theme storage", () => {
  it("reads only a known theme and survives blocked storage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "neon");
    expect(readStoredTheme()).toBeNull();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } } as unknown as Storage;
    expect(readStoredTheme(blocked)).toBeNull();
    expect(() => storeTheme("daylight", blocked)).not.toThrow();
  });
});

describe("chooseTheme", () => {
  it("switches at once, stores in the browser, and saves on the profile", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, data: { theme: "daylight" } });
    const pending = chooseTheme("daylight", "blueprint", save);
    expect(themeStore.getState().theme).toBe("daylight"); // before the server answers
    await pending;
    expect(save).toHaveBeenCalledWith("daylight");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("daylight");
    expect(toastStore.getState().visible).toHaveLength(0);
  });

  it("puts the previous theme back with an error toast when the profile cannot be updated", async () => {
    await chooseTheme("contrast", "daylight", vi.fn().mockResolvedValue({ ok: false, code: "INTERNAL", message: "x" }));
    expect(themeStore.getState().theme).toBe("daylight");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("daylight");
    expect(toastStore.getState().visible[0]).toMatchObject({ title: "High contrast could not be saved", variant: "danger" });
    await chooseTheme("contrast", "daylight", vi.fn().mockRejectedValue(new Error("offline")));
    expect(themeStore.getState().theme).toBe("daylight");
  });

  it("a newer choice made meanwhile is not undone by an older failure", async () => {
    let fail!: () => void;
    const slow = vi.fn(() => new Promise<{ ok: false; code: "INTERNAL"; message: string }>((r) => (fail = () => r({ ok: false, code: "INTERNAL", message: "x" }))));
    const first = chooseTheme("daylight", "blueprint", slow);
    await chooseTheme("contrast", "daylight", vi.fn().mockResolvedValue({ ok: true, data: { theme: "contrast" } }));
    fail();
    await first;
    expect(themeStore.getState().theme).toBe("contrast");
  });

  it("choosing the current theme does nothing", async () => {
    const save = vi.fn();
    await chooseTheme("blueprint", "blueprint", save);
    expect(save).not.toHaveBeenCalled();
  });
});
