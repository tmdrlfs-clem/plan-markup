// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { viewerCommands } from "../viewer-commands";
import { cursorStore, setCursor } from "./cursor-store";
import { DEFAULT_SNAP, snapSettings } from "./snap-settings";
import { CursorReadout, PageSizeItem, ScaleIndicator, SnapToggles, ZoomItem, scaleItem } from "./status-items";

const MM = 72 / 25.4;
const wrap = (ui: React.ReactElement) => render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

afterEach(() => {
  vi.restoreAllMocks();
  snapSettings.setState(DEFAULT_SNAP, true);
  cursorStore.setState({ point: null });
});

describe("PageSizeItem", () => {
  it("names the sheet with its size; narrow, an icon with the size for assistive technology and in the tooltip", async () => {
    const user = userEvent.setup();
    wrap(<PageSizeItem page={{ width: 841 * MM, height: 594 * MM }} />);
    const wide = screen.getByTestId("status-page-size");
    expect(wide).toHaveTextContent("A1 841 × 594 mm");
    expect(wide).toHaveClass("hidden", "ws-md:inline-flex");
    const narrow = screen.getAllByText("A1 841 × 594 mm")[1];
    expect(narrow).toHaveClass("sr-only");
    await user.hover(wide);
    expect(await screen.findByRole("tooltip", {}, { timeout: 2000 })).toHaveTextContent("Page size: A1, landscape, 841 × 594 mm");
  });

  it("gives other sizes in millimetres", () => {
    wrap(<PageSizeItem page={{ width: 400 * MM, height: 700 * MM }} />);
    expect(screen.getByTestId("status-page-size")).toHaveTextContent("400 × 700 mm");
  });
});

describe("ScaleIndicator", () => {
  it("shows '⚠ Scale not set' in the warning colour with the warning icon, and says calibration comes later", async () => {
    const user = userEvent.setup();
    wrap(<ScaleIndicator state={{ kind: "not-set" }} />);
    const item = screen.getByTestId("status-scale");
    expect(item).toHaveTextContent("Scale not set");
    expect(item).toHaveClass("text-warning-text");
    expect(item.querySelector("svg.lucide-triangle-alert")).toBeInTheDocument();
    expect(item.tagName).toBe("SPAN"); // nothing to act on before Epic 4
    await user.hover(item);
    expect(await screen.findByRole("tooltip", {}, { timeout: 2000 })).toHaveTextContent("Calibration arrives with the Measure tools");
  });

  it("already shows the calibrated, detected and mixed states (Stories 4.3 / 4.4 only wire data)", () => {
    expect(scaleItem({ kind: "set", label: "1:100" })).toMatchObject({ label: "Scale 1:100", tone: "success" });
    expect(scaleItem({ kind: "detected", label: "1:100" })).toMatchObject({ label: "Scale 1:100 detected — Verify", tone: "warning" });
    expect(scaleItem({ kind: "mixed", count: 2 })).toMatchObject({ label: "2 scales on page", tone: "warning" });
    wrap(<ScaleIndicator state={{ kind: "set", label: "1:50" }} />);
    expect(screen.getByTestId("status-scale").querySelector("svg.lucide-circle-check")).toBeInTheDocument();
  });
});

describe("SnapToggles", () => {
  it("three toggles with aria-pressed that set the remembered preference", async () => {
    const user = userEvent.setup();
    wrap(<SnapToggles />);
    const group = screen.getByRole("group", { name: "Snap" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => [b.getAttribute("aria-label"), b.getAttribute("aria-pressed")])).toEqual([
      ["Snap to content", "true"],
      ["Snap to markups", "true"],
      ["Snap to grid", "false"],
    ]);
    await user.click(buttons[2]);
    await user.click(buttons[0]);
    expect(snapSettings.getState()).toEqual({ content: false, markup: true, grid: true });
    expect(buttons[2]).toHaveAttribute("aria-pressed", "true");
    await user.hover(buttons[1]);
    expect(await screen.findByRole("tooltip", {}, { timeout: 2000 })).toHaveTextContent(/will snap to markup points and edges/);
  });
});

describe("CursorReadout", () => {
  it("writes the point straight into its text, never announced; blank without a point", () => {
    let renders = 0;
    function Counted() {
      renders++;
      return <CursorReadout />;
    }
    render(<Counted />);
    const readout = screen.getByTestId("status-cursor");
    expect(readout).toHaveAttribute("aria-live", "off");
    expect(readout).toHaveTextContent("");
    act(() => setCursor({ x: 1234.54, y: 678.91 }));
    expect(readout.textContent).toBe("X 1234.5  Y 678.9 pt");
    act(() => setCursor({ x: 1, y: 2 }));
    act(() => setCursor(null));
    expect(readout.textContent).toBe("");
    expect(renders).toBe(1);
  });
});

describe("ZoomItem", () => {
  it("shows the zoom and opens a menu of fits and presets", async () => {
    const user = userEvent.setup();
    const zoomTo = vi.spyOn(viewerCommands, "zoomTo").mockImplementation(() => undefined);
    const fitPage = vi.spyOn(viewerCommands, "fitPage").mockImplementation(() => undefined);
    wrap(<ZoomItem zoom={106} />);
    const trigger = screen.getByRole("button", { name: "Zoom 106%" });
    expect(trigger).toHaveTextContent("106%");
    await user.click(trigger);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.replace(/Ctrl.*$/, "").trim())).toEqual([
      "Fit page",
      "Fit width",
      "50%",
      "100%",
      "200%",
      "400%",
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: "200%" }));
    expect(zoomTo).toHaveBeenCalledWith(200);
    await user.click(trigger);
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Fit page/ }));
    expect(fitPage).toHaveBeenCalledTimes(1);
  });
});
