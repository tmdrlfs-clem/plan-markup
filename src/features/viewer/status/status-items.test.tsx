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
    expect(wide.parentElement).toHaveClass("hidden", "ws-md:contents");
    expect(screen.getByTestId("status-page-size-icon").parentElement).toHaveClass("contents", "ws-md:hidden");
    const narrow = screen.getAllByText("A1 841 × 594 mm")[1];
    expect(narrow).toHaveClass("sr-only");
    await user.hover(wide);
    expect(await screen.findByRole("tooltip", {}, { timeout: 2000 })).toHaveTextContent("Page size: A1, landscape, 841 × 594 mm");
  });

  it("the icon item is a tab stop whose tooltip opens on focus: the size is reachable by keyboard (review R3)", async () => {
    wrap(<PageSizeItem page={{ width: 841 * MM, height: 594 * MM }} />);
    const icon = screen.getByTestId("status-page-size-icon");
    expect(icon).toHaveAttribute("tabindex", "0");
    expect(icon).toHaveClass("focus-ring");
    act(() => icon.focus());
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
  const PLAIN = { width: 2000, height: 1500, rotate: 0 };

  it("writes the point straight into its text, never announced; blank without a point", () => {
    let renders = 0;
    function Counted() {
      renders++;
      return <CursorReadout page={PLAIN} />;
    }
    render(<Counted />);
    const readout = screen.getByTestId("status-cursor");
    const value = screen.getByTestId("status-cursor-value");
    expect(readout).toHaveAttribute("aria-live", "off");
    expect(readout).not.toHaveAttribute("aria-label");
    expect(readout).toHaveTextContent(/^Cursor position$/);
    expect(value).toHaveTextContent("");
    act(() => setCursor({ x: 1234.54, y: 678.91 }));
    expect(value.textContent).toBe("X 1234.5  Y 678.9 pt");
    act(() => setCursor({ x: 1, y: 2 }));
    act(() => setCursor(null));
    expect(value.textContent).toBe("");
    expect(renders).toBe(1);
    act(() => setCursor(null));
  });

  it("shows the user space point from the page's bottom-left corner, in points (review R1: L17's box is centred on 0, 0)", () => {
    const l17 = { width: 2383.94, height: 1683.78, rotate: 0, view: [-1191.97, -841.89, 1191.97, 841.89] as [number, number, number, number], userUnit: 1 };
    const { rerender } = render(<CursorReadout page={l17} />);
    act(() => setCursor({ x: -1091.97, y: 741.89 }));
    expect(screen.getByTestId("status-cursor-value").textContent).toBe("X 100.0  Y 1583.8 pt");
    // A UserUnit of 2: points are twice the user units.
    rerender(<CursorReadout page={{ ...l17, width: 4767.88, height: 3367.56, userUnit: 2 }} />);
    expect(screen.getByTestId("status-cursor-value").textContent).toBe("X 200.0  Y 3167.6 pt");
    act(() => setCursor(null));
  });

  it("grows rather than overflow for a long readout (review R4)", () => {
    render(<CursorReadout page={PLAIN} />);
    expect(screen.getByTestId("status-cursor")).toHaveClass("min-w-[22ch]");
    expect(screen.getByTestId("status-cursor")).not.toHaveClass("w-[22ch]");
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

describe("ScaleIndicator keyboard access (Story 4.2)", () => {
  it("a detected scale is a tab stop whose tooltip (with the conversion) opens on focus; Scale not set is not", async () => {
    const { unmount } = wrap(<ScaleIndicator state={{ kind: "detected", label: "1:200 (1:100 @ A1)", note: "1:100 @ A1 → 1:200 on this A3 page" }} />);
    const item = screen.getByTestId("status-scale");
    expect(item).toHaveAttribute("tabindex", "0");
    act(() => item.focus());
    expect(await screen.findByRole("tooltip", {}, { timeout: 2000 })).toHaveTextContent("1:100 @ A1 → 1:200 on this A3 page");
    unmount();
    wrap(<ScaleIndicator state={{ kind: "not-set" }} />);
    expect(screen.getByTestId("status-scale")).not.toHaveAttribute("tabindex");
    expect(screen.getByTestId("status-scale")).toHaveAttribute("data-detection", "done");
  });

  it("review D1/D7: disagreeing scales are a warning tab stop with both readings; pending detection is marked", async () => {
    const { unmount } = wrap(<ScaleIndicator state={{ kind: "conflict", readings: ["1:75 @ A1 = 1:75 on this A1 page", "1:200 @ A3 = 1:100 on this A1 page"] }} />);
    const item = screen.getByTestId("status-scale");
    expect(item).toHaveTextContent("Scales disagree — Verify");
    expect(item).toHaveAttribute("data-tone", "warning");
    expect(item).toHaveAttribute("tabindex", "0");
    act(() => item.focus());
    expect(await screen.findByRole("tooltip", {}, { timeout: 2000 })).toHaveTextContent("1:200 @ A3 = 1:100 on this A1 page");
    unmount();
    wrap(<ScaleIndicator state={{ kind: "not-set", pending: true }} />);
    expect(screen.getByTestId("status-scale")).toHaveAttribute("data-detection", "pending");
    expect(screen.getByTestId("status-scale")).toHaveTextContent("Scale not set");
  });
});

