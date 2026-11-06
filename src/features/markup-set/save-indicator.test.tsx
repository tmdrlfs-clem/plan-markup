// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ saveNow: vi.fn() }));
vi.mock("./actions", () => ({ ensureMarkupSet: vi.fn(), saveSetCalibrations: vi.fn(), applyMarkupOps: vi.fn(), loadMarkupSet: vi.fn(), hasMarkupsOnOtherVersion: vi.fn(), listMyMarkupSets: vi.fn() }));
vi.mock("./sync", async (importOriginal) => ({ ...(await importOriginal<typeof import("./sync")>()), saveNow: m.saveNow }));

import { TooltipProvider } from "@/components/ui/tooltip";

import { SaveIndicator, saveLabel } from "./save-indicator";
import { saveStatusStore } from "./sync";

describe("SaveIndicator (Story 6.3, UX-DR10)", () => {
  it("labels the five states with their tone", () => {
    expect(saveLabel({ state: "saved", pending: 0, lastSavedAt: null })).toEqual({ label: "Saved", tone: "success" });
    expect(saveLabel({ state: "saving", pending: 2, lastSavedAt: null })).toEqual({ label: "Saving…", tone: "default" });
    expect(saveLabel({ state: "offline", pending: 1, lastSavedAt: null })).toEqual({ label: "Offline — 1 change waiting", tone: "warning" });
    expect(saveLabel({ state: "offline", pending: 3, lastSavedAt: null })).toEqual({ label: "Offline — 3 changes waiting", tone: "warning" });
    expect(saveLabel({ state: "error", pending: 3, lastSavedAt: null })).toEqual({ label: "Not synced — Retry", tone: "danger" });
    expect(saveLabel({ state: "local", pending: 3, lastSavedAt: null })).toEqual({ label: "Local only — Sign in to save", tone: "warning" });
  });

  it("follows the status and opens the details with Retry", async () => {
    act(() => saveStatusStore.setState({ state: "saved", pending: 0, lastSavedAt: null }));
    render(
      <TooltipProvider>
        <SaveIndicator />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("status-save")).toHaveTextContent("Saved");
    act(() => saveStatusStore.setState({ state: "error", pending: 2, lastSavedAt: Date.UTC(2026, 10, 7, 1, 2, 3) }));
    const item = screen.getByTestId("status-save");
    expect(item).toHaveTextContent("Not synced — Retry");
    expect(item).toHaveAttribute("data-state", "error");
    await userEvent.click(item);
    const details = await screen.findByTestId("save-details");
    expect(details).toHaveTextContent("2 changes waiting on this computer");
    expect(details).toHaveTextContent(/Last saved at/);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(m.saveNow).toHaveBeenCalled();
  });
});
