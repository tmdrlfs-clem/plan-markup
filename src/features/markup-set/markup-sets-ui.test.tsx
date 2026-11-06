// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ list: vi.fn(), pages: vi.fn(), open: vi.fn(), openAs: vi.fn() }));
vi.mock("./actions", () => ({
  ensureMarkupSet: vi.fn(),
  saveSetCalibrations: vi.fn(),
  applyMarkupOps: vi.fn(),
  loadMarkupSet: vi.fn(),
  hasMarkupsOnOtherVersion: vi.fn(),
  listMyMarkupSets: m.list,
  loadMarkupSetPages: m.pages,
}));
vi.mock("@/features/viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/viewer")>()),
  openDocument: m.open,
  openDocumentAs: m.openAs,
}));

import { hintStore } from "@/components/ui/hint-store";
import { viewerStore } from "@/features/viewer";

import { createHash } from "node:crypto";

import {
  BLANK_PAGES_HINT_ID,
  MarkupSetListDialog,
  OPEN_PDF,
  OPEN_SET_LIST,
  OTHER_VERSION_HINT,
  OpenMarkupSetDialog,
  markOtherVersion,
  markupSetsUi,
  openMarkupSetList,
  openOnBlankPages,
  openSetWithFile,
  useBlankPagesHint,
  useOtherVersionHint,
  useRecentSets,
} from "./markup-sets-ui";

const SHA = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  act(() => {
    markupSetsUi.setState({ otherVersion: {}, listOpen: false, list: { status: "loading" }, opening: null, blank: {}, recent: null });
    viewerStore.setState({ documentId: SHA, dismissedNotices: [], standIn: false });
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

const BYTES = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
const BYTES_SHA = createHash("sha256").update(BYTES).digest("hex");
const SET = { drawingId: "d1", title: "L17.pdf", filename: "L17.pdf", sha256: BYTES_SHA, pageCount: 2, markupCount: 4, lastModified: "2026-11-07T01:00:00Z" };
const PAGES = { sha256: BYTES_SHA, filename: "L17.pdf", pages: [{ rotation: 0, cropBox: [0, 0, 600, 400], width: 600, height: 400 }, { rotation: 90, cropBox: [0, 0, 600, 400], width: 400, height: 600 }] };

describe("opening a markup set (Story 6.6)", () => {
  it("the same bytes open as usual (the markups restore)", async () => {
    await openSetWithFile(SET, new File([BYTES], "renamed.pdf", { type: "application/pdf" }));
    expect(m.open).toHaveBeenCalledTimes(1);
    expect(m.openAs).not.toHaveBeenCalled();
    expect(m.pages).not.toHaveBeenCalled();
  });

  it("other bytes, or Blank pages, show the markups on blank pages named and counted like the set's file", async () => {
    m.pages.mockResolvedValue({ ok: true, data: PAGES });
    await openSetWithFile(SET, new File([new Uint8Array([1])], "L17.pdf", { type: "application/pdf" }));
    expect(m.open).not.toHaveBeenCalled();
    expect(m.openAs).toHaveBeenCalledTimes(1);
    const [file, documentId] = m.openAs.mock.calls[0] as [File, string];
    expect(documentId).toBe(BYTES_SHA);
    expect(file.name).toBe("L17.pdf");
    expect(new TextDecoder().decode((await file.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect(markupSetsUi.getState().blank[BYTES_SHA]).toBeTruthy();

    // The notice while the tab shows the blank pages, with a way to the PDF.
    renderHook(() => useBlankPagesHint());
    act(() => viewerStore.setState({ documentId: BYTES_SHA, standIn: true, dismissedNotices: [] }));
    const hint = hintStore.getState().hint!;
    expect(hint).toMatchObject({ id: BLANK_PAGES_HINT_ID, variant: "info", text: "Markups on blank pages: L17.pdf, 2 pages", action: { label: OPEN_PDF } });
    act(() => hint.action!.onAction());
    expect(markupSetsUi.getState().opening?.drawingId).toBe("d1");
    // The PDF itself replaced them: no notice.
    act(() => viewerStore.setState({ standIn: false }));
    expect(hintStore.getState().hint).toBeNull();
  });

  it("a set that cannot be loaded opens nothing", async () => {
    m.pages.mockResolvedValue({ ok: true, data: null });
    await openOnBlankPages(SET);
    expect(m.openAs).not.toHaveBeenCalled();
  });

  it("the dialog asks for the PDF or blank pages; the list's Open… and the recent list lead to it", async () => {
    m.list.mockResolvedValue({ ok: true, data: [SET] });
    m.pages.mockResolvedValue({ ok: true, data: PAGES });
    render(
      <>
        <MarkupSetListDialog />
        <OpenMarkupSetDialog />
      </>,
    );
    act(() => openMarkupSetList());
    await userEvent.click(await screen.findByRole("button", { name: "Open L17.pdf" }));
    expect(markupSetsUi.getState().listOpen).toBe(false);
    const dialog = await screen.findByRole("dialog", { name: "Open L17.pdf" });
    expect(dialog.textContent).toContain("blank pages (2 pages)");
    // Choose PDF… opens the picker (outside the modal).
    const input = screen.getByTestId<HTMLInputElement>("open-set-input");
    const picked = vi.spyOn(input, "click").mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole("button", { name: "Choose PDF…" }));
    expect(picked).toHaveBeenCalled();
    await userEvent.setup({ pointerEventsCheck: 0 }).upload(screen.getByTestId("open-set-input"), new File([BYTES], "L17.pdf", { type: "application/pdf" }));
    await vi.waitFor(() => expect(m.open).toHaveBeenCalledTimes(1));
    expect(markupSetsUi.getState().opening).toBeNull();

    act(() => markupSetsUi.setState({ opening: SET }));
    await userEvent.click(await screen.findByRole("button", { name: "Blank pages" }));
    await vi.waitFor(() => expect(m.openAs).toHaveBeenCalledTimes(1));

    const { result } = renderHook(() => useRecentSets(true));
    await vi.waitFor(() => expect(result.current).toEqual([{ id: "d1", name: "L17.pdf", detail: expect.stringMatching(/^2 pages · /) }]));
  });
});
