// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./actions", () => ({
  ensureMarkupSet: vi.fn(),
  saveSetCalibrations: vi.fn(),
  applyMarkupOps: vi.fn(),
  loadMarkupSet: vi.fn(),
  hasMarkupsOnOtherVersion: vi.fn(),
  listMyMarkupSets: m.list,
}));

import { hintStore } from "@/components/ui/hint-store";
import { viewerStore } from "@/features/viewer";

import { MarkupSetListDialog, OPEN_SET_LIST, OTHER_VERSION_HINT, markOtherVersion, markupSetsUi, openMarkupSetList, useOtherVersionHint } from "./markup-sets-ui";

const SHA = "a".repeat(64);

beforeEach(() => {
  act(() => {
    markupSetsUi.setState({ otherVersion: {}, listOpen: false, list: { status: "loading" } });
    viewerStore.setState({ documentId: SHA, dismissedNotices: [] });
    hintStore.setState({ hint: null });
  });
});

describe("another version notice (Story 6.5)", () => {
  it("shows for the shown document, offers the set list, and stays dismissed for it", () => {
    renderHook(() => useOtherVersionHint());
    expect(hintStore.getState().hint).toBeNull();
    act(() => markOtherVersion(SHA));
    const hint = hintStore.getState().hint!;
    expect(hint).toMatchObject({ variant: "info", text: OTHER_VERSION_HINT, action: { label: OPEN_SET_LIST } });
    // Never wording that suggests loss.
    expect(hint.text).not.toMatch(/lost|missing|deleted|gone/i);
    m.list.mockResolvedValue({ ok: true, data: [] });
    act(() => hint.action!.onAction());
    expect(markupSetsUi.getState().listOpen).toBe(true);
    act(() => hint.onDismiss!());
    expect(hintStore.getState().hint).toBeNull();
    act(() => viewerStore.setState({ documentId: "b".repeat(64), dismissedNotices: [] }));
    expect(hintStore.getState().hint).toBeNull();
  });
});

describe("markup set list (Story 6.6)", () => {
  it("lists the sets newest first with filename, pages and markups; an empty state", async () => {
    m.list.mockResolvedValue({
      ok: true,
      data: [
        { drawingId: "1", title: "L17 RCP.pdf", filename: "L17 RCP.pdf", sha256: SHA, pageCount: 12, markupCount: 40, lastModified: "2026-11-07T01:00:00Z" },
        { drawingId: "2", title: "L16.pdf", filename: "L16.pdf", sha256: SHA, pageCount: 3, markupCount: 0, lastModified: "2026-11-06T01:00:00Z" },
      ],
    });
    render(<MarkupSetListDialog />);
    act(() => openMarkupSetList());
    const rows = await screen.findAllByTestId("markup-set-row");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("L17 RCP.pdf1240"), expect.stringContaining("L16.pdf30")]);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(markupSetsUi.getState().listOpen).toBe(false);

    m.list.mockResolvedValue({ ok: true, data: [] });
    act(() => openMarkupSetList());
    expect(await screen.findByText(/No markup sets yet/)).toBeTruthy();
  });
});
