// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { PDFDocument } from "@cantoo/pdf-lib";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const opened: File[][] = [];
vi.mock("./open-files", () => ({ openFiles: (files: File[]) => void opened.push(files) }));

import { NewDocumentDialog, newDocumentStore, openNewDocument } from "./new-document-dialog";

describe("New drawing (founder 2026-11-21)", () => {
  it("makes a blank PDF of the chosen size, orientation and pages and opens it", async () => {
    const user = userEvent.setup();
    render(<NewDocumentDialog />);
    act(() => openNewDocument());
    expect(screen.getByRole("dialog", { name: "New drawing" })).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "Page size" }));
    await user.click(screen.getByRole("option", { name: /^A1/ }));
    await user.click(screen.getByRole("combobox", { name: "Orientation" }));
    await user.click(screen.getByRole("option", { name: "Portrait" }));
    const pages = screen.getByRole("spinbutton", { name: "Pages" });
    await user.clear(pages);
    await user.type(pages, "4");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(opened).toHaveLength(1));
    const [file] = opened[0];
    expect(file.name).toMatch(/^Untitled A1 portrait .*\.pdf$/);
    const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPage(0).getSize()).toEqual({ width: 1683.78, height: 2383.94 });
    await waitFor(() => expect(newDocumentStore.getState().open).toBe(false));
  });
});
