// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hintStore } from "@/components/ui/hint-store";
import { resetToasts, toastStore } from "@/components/ui/toast-store";
import {
  ANNOUNCE_DELAY_MS,
  ANNOUNCE_LABEL_WAIT_MS,
  openDocument,
  resetViewer,
  setTool,
  tabsStore,
  viewerCommands,
  viewerStore,
  viewerTabs,
} from "@/features/viewer";

import { storageKey } from "./layout-persistence";
import { BANNER_DISMISSED_KEY } from "./narrow-banner";
import { WorkspaceShell } from "./workspace-shell";

const signOut = vi.fn<() => Promise<void>>(async () => {});
vi.mock("@/features/account/actions", () => ({ signOut: () => signOut() }));
const saveTheme = vi.fn(async (theme: string) => ({ ok: true as const, data: { theme } }));
vi.mock("@/features/appearance/actions", () => ({ setTheme: (theme: string) => saveTheme(theme) }));

// The real viewport starts a render worker (none in jsdom); its own tests cover it.
vi.mock("@/features/viewer/canvas-viewport", () => ({
  CanvasViewport: ({ onOpen }: { onOpen: () => void }) => (
    <div data-testid="canvas-viewport">
      <button type="button" onClick={onOpen}>
        Open another file
      </button>
    </div>
  ),
}));

const USER = { id: "user-1", name: "Sam Drafter", email: "sam@example.com" };

// Each test renders the whole shell (menus, rails, panels); under full-suite load that can pass 5 s.
vi.setConfig({ testTimeout: 20_000 });

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }) as unknown as typeof window.matchMedia;
}

function setup() {
  const user = userEvent.setup();
  const view = render(<WorkspaceShell user={USER} />);
  return { user, ...view };
}

beforeEach(() => {
  setViewport(1920, 1080);
  localStorage.clear();
  sessionStorage.clear();
  resetToasts();
  resetViewer();
  hintStore.setState({ hint: null });
  signOut.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Length snapping preview (Story 4.1)", () => {
  it("arming Length shows what it does in the HintBar, with a note on a page snapped only in part; another tool hides it", async () => {
    const { user } = setup();
    act(() => {
      openDocument(new File(["%PDF"], "a.pdf", { type: "application/pdf" }));
      viewerStore.setState({ status: "ready", pageCount: 1, zoom: 64 });
    });
    await user.click(screen.getByRole("radio", { name: "Length" }));
    expect(hintStore.getState().hint?.text).toMatch(/^Length: click the start and the end point/);
    act(() => viewerStore.setState({ snapPartial: true }));
    expect(hintStore.getState().hint?.text).toMatch(/snapping covers only part of its linework/);
    await user.click(screen.getByRole("radio", { name: "Select" }));
    expect(hintStore.getState().hint).toBeNull();
  });

  it("the measuring tools share one slot: the menu arms any of them and the slot shows the last armed", async () => {
    const { user } = setup();
    act(() => {
      openDocument(new File(["%PDF"], "a.pdf", { type: "application/pdf" }));
      viewerStore.setState({ status: "ready", pageCount: 1, zoom: 64 });
    });
    const rail = screen.getByRole("toolbar", { name: "Drawing tools" });
    expect(within(rail).getByRole("radio", { name: "Length" })).not.toBeChecked();
    await user.click(within(rail).getByRole("button", { name: "More measure tools" }));
    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("Length"),
      expect.stringContaining("Polylength"),
      expect.stringContaining("Area"),
      expect.stringContaining("Count"),
      "Angle",
      "Radius",
      "Diameter",
      expect.stringContaining("Dynamic fill"),
    ]);
    await user.click(screen.getByRole("menuitemradio", { name: "Radius" }));
    expect(viewerStore.getState().tool).toBe("radius");
    expect(within(rail).getByRole("radio", { name: "Radius" })).toBeChecked();
    expect(within(rail).queryByRole("radio", { name: "Length" })).toBeNull();
    // Another tool: the slot keeps Radius, unchecked; clicking it arms Radius again.
    await user.click(within(rail).getByRole("radio", { name: "Select" }));
    expect(within(rail).getByRole("radio", { name: "Radius" })).not.toBeChecked();
    await user.click(within(rail).getByRole("radio", { name: "Radius" }));
    expect(viewerStore.getState().tool).toBe("radius");
    // A shortcut-armed tool takes the slot too.
    act(() => setTool("area"));
    expect(within(rail).getByRole("radio", { name: "Area" })).toBeChecked();
  });
});

describe("Settings > Appearance (Story 3.8)", () => {
  it("renders the profile's theme on the workspace root and <html>, lists the three themes with the current one checked, and switches at once", async () => {
    const user = userEvent.setup();
    const view = render(<WorkspaceShell user={USER} theme="daylight" />);
    expect(screen.getByTestId("workspace-root")).toHaveAttribute("data-theme", "daylight");
    expect(document.documentElement).toHaveAttribute("data-theme", "daylight");
    await user.click(screen.getByRole("menuitem", { name: "Settings" }));
    await user.click(await screen.findByRole("menuitem", { name: "Appearance" }));
    const radios = await screen.findAllByRole("menuitemradio");
    expect(radios.map((r) => r.textContent)).toEqual(["Blueprint", "Daylight", "High contrast"]);
    expect(screen.getByRole("menuitemradio", { name: "Daylight" })).toHaveAttribute("aria-checked", "true");
    // (A pointer click on a submenu item does not select in jsdom; the e2e clicks it.)
    act(() => screen.getByRole("menuitemradio", { name: "High contrast" }).focus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("workspace-root")).toHaveAttribute("data-theme", "contrast"));
    expect(document.documentElement).toHaveAttribute("data-theme", "contrast");
    await waitFor(() => expect(saveTheme).toHaveBeenCalledWith("contrast"));
    view.unmount();
    expect(document.documentElement).toHaveAttribute("data-theme", "blueprint");
  });

  it("is keyboard accessible: Enter opens the submenu, arrows move, Enter picks", async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell user={USER} theme="blueprint" />);
    screen.getByRole("menuitem", { name: "Settings" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menuitem", { name: /Keyboard shortcuts/ });
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement).toHaveTextContent("Appearance"));
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(document.activeElement).toHaveAttribute("role", "menuitemradio"));
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.getByTestId("workspace-root")).toHaveAttribute("data-theme", "daylight"));
  });
});

describe("WorkspaceShell layout", () => {
  it("has the landmarks and the eight menus in order", () => {
    setup();
    // Panel headers count as banners in jsdom (browsers scope them to their section).
    const banner = screen.getAllByRole("banner").find((b) => within(b).queryByRole("menubar"));
    expect(banner).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Panels" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Tool Chest" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Markups" })).toBeInTheDocument();
    const menubar = screen.getByRole("menubar", { name: "Main menu" });
    expect(within(menubar).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "File",
      "Edit",
      "View",
      "Document",
      "Tools",
      "Window",
      "Settings",
      "Help",
    ]);
    expect(screen.getByRole("contentinfo")).toHaveTextContent("No drawing open");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("shows the empty workspace with Open and no recent drawings", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Drop a PDF here or Open…" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("button", { name: "Open…" })).toBeInTheDocument();
    expect(screen.getByText("No recent drawings")).toBeInTheDocument();
  });

  it("disables every drawing tool with the reason", () => {
    setup();
    const rail = screen.getByRole("toolbar", { name: "Drawing tools" });
    const tools = within(rail).getAllByRole("radio");
    // The measuring tools share one slot and a menu (Story 5.4: the line tools too).
    expect(tools.length).toBe(13);
    for (const tool of tools) expect(tool).toHaveAttribute("aria-disabled", "true");
    expect(within(rail).getByRole("button", { name: "More measure tools" })).toHaveAttribute("aria-disabled", "true");
    expect(within(rail).getByRole("button", { name: "More line tools" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Select a tool to see its options")).toBeInTheDocument();
  });

  it("starts collapsed below 1440 px wide", () => {
    setViewport(1366, 768);
    setup();
    expect(screen.queryByRole("complementary", { name: "Tool Chest" })).not.toBeInTheDocument();
    expect(screen.getByText("Markups you add appear here.").parentElement).toHaveAttribute("hidden");
  });
});

describe("panels", () => {
  it("the rail switches panels and collapses the active one", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "Layers" }));
    expect(screen.getByRole("complementary", { name: "Layers" })).toHaveTextContent("No layers yet");
    await user.click(screen.getByRole("radio", { name: "Layers" }));
    expect(screen.queryByRole("complementary", { name: "Layers" })).not.toBeInTheDocument();
  });

  it("remembers the layout per user across a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, unmount } = setup();
    await user.click(screen.getByRole("radio", { name: "Properties" }));
    await user.click(screen.getByRole("button", { name: "Collapse Markups" }));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const stored = JSON.parse(localStorage.getItem(storageKey(USER.id)) ?? "null");
    expect(stored).toMatchObject({ v: 1, left: { active: "properties", collapsed: false }, bottom: { collapsed: true } });
    unmount();

    render(<WorkspaceShell user={USER} />);
    expect(screen.getByRole("complementary", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByText("Markups you add appear here.").parentElement).toHaveAttribute("hidden");
  });

  it("Alt+L twice in one frame toggles twice; a held Alt+X toggles once", () => {
    setup();
    const body = () => screen.getByText("Markups you add appear here.").parentElement;
    fireEvent.keyDown(window, { altKey: true, code: "KeyL", key: "l" });
    fireEvent.keyDown(window, { altKey: true, code: "KeyL", key: "l" });
    expect(body()).not.toHaveAttribute("hidden");
    fireEvent.keyDown(window, { altKey: true, code: "KeyX", key: "x" });
    fireEvent.keyDown(window, { altKey: true, code: "KeyX", key: "x", repeat: true });
    fireEvent.keyDown(window, { altKey: true, code: "KeyX", key: "x", repeat: true });
    expect(screen.queryByRole("complementary", { name: "Tool Chest" })).not.toBeInTheDocument();
  });

  it("Alt+T shows the Thumbnails panel: its empty text without a drawing, the page list with one", () => {
    setup();
    fireEvent.keyDown(window, { altKey: true, code: "KeyT", key: "t" });
    const panel = screen.getByRole("complementary", { name: "Thumbnails" });
    expect(within(panel).getByText("No drawing open")).toBeInTheDocument();
    expect(within(panel).queryByRole("listbox")).not.toBeInTheDocument();
    act(() => {
      openDocument(new File(["%PDF"], "a.pdf", { type: "application/pdf" }));
      viewerStore.setState({
        status: "ready",
        pageCount: 2,
        pages: [
          { width: 1191, height: 842, rotate: 0 },
          { width: 595, height: 842, rotate: 0 },
        ],
        documentId: "doc",
        pageLabels: ["A1721 - LEVEL 17", "A2121 - LEVEL 21"],
      });
    });
    const list = within(panel).getByRole("listbox", { name: "Page thumbnails" });
    expect(within(list).getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual(["Page 1, A1721", "Page 2, A2121"]);
  });

  it("saves a change made just before the page is left", () => {
    setup();
    fireEvent.keyDown(window, { altKey: true, code: "KeyL", key: "l" });
    expect(localStorage.getItem(storageKey(USER.id))).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(localStorage.getItem(storageKey(USER.id)) ?? "null")).toMatchObject({ bottom: { collapsed: true } });
  });

  it("collapsing a panel that holds the focus moves it to the rail or the Expand button", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Collapse Tool Chest" }));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Tool Chest" }));

    await user.click(screen.getByRole("radio", { name: "Layers" }));
    screen.getByRole("button", { name: "Collapse Layers" }).focus();
    fireEvent.keyDown(document.activeElement as Element, { altKey: true, code: "KeyY", key: "y" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Layers" }));

    screen.getByRole("separator", { name: "Resize Markups" }).focus();
    await user.keyboard("{Shift>}{F4}{/Shift}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Expand Markups" }));
  });

  it("Shift+F4 hides all panels and Alt+L brings the Markups list back", async () => {
    const { user } = setup();
    await user.keyboard("{Shift>}{F4}{/Shift}");
    expect(screen.queryByRole("complementary", { name: "Tool Chest" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { altKey: true, code: "KeyL", key: "l" });
    expect(screen.getByText("Markups you add appear here.").parentElement).not.toHaveAttribute("hidden");
  });
});

describe("F6 regions", () => {
  function regionOf(element: Element | null): string | undefined {
    return (element?.closest("[data-region]") as HTMLElement | null)?.dataset.region;
  }

  it("cycles forward and back through the visible regions", async () => {
    const { user } = setup();
    const order: (string | undefined)[] = [];
    for (let i = 0; i < 9; i++) {
      await user.keyboard("{F6}");
      order.push(regionOf(document.activeElement));
    }
    expect(order, JSON.stringify(order)).toEqual([
      "menu-bar",
      "toolbar",
      "panel-rail",
      "left-panel",
      "canvas",
      "tool-rail",
      "bottom-panel",
      "status-bar",
      "menu-bar",
    ]);
    await user.keyboard("{Shift>}{F6}{/Shift}");
    expect(regionOf(document.activeElement)).toBe("status-bar");
  });

  it("skips the collapsed bottom panel", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Collapse Markups" }));
    screen.getByRole("radio", { name: "Length" }).focus();
    await user.keyboard("{F6}");
    expect(regionOf(document.activeElement)).toBe("status-bar");
  });

  it("skips the collapsed left panel", async () => {
    setViewport(1366, 768);
    const { user } = setup();
    screen.getByRole("radio", { name: "Tool Chest" }).focus();
    await user.keyboard("{F6}");
    expect(regionOf(document.activeElement)).toBe("canvas");
  });

  it("does nothing while a menu is open", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    const open = await screen.findByRole("menuitem", { name: /Open…/ });
    await waitFor(() => expect(screen.getByRole("menu")).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard("{F6}");
    expect(screen.getByRole("menu")).toContainElement(document.activeElement as HTMLElement);
    expect(open).toBeInTheDocument();
  });
});

describe("opening files", () => {
  function drop(files: File[]) {
    const zone = screen.getByTestId("drop-zone");
    const dataTransfer = { files, types: ["Files"], dropEffect: "none" };
    fireEvent.dragEnter(zone, { dataTransfer });
    expect(zone).toHaveAttribute("data-dragging", "true");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Drop to open");
    fireEvent.drop(zone, { dataTransfer });
    // A PDF replaces the drop zone with the viewer; a refused file leaves it idle.
    if (zone.isConnected) expect(zone).not.toHaveAttribute("data-dragging");
  }

  it("a dropped PDF opens in the viewer: canvas, status bar name and window title", () => {
    setup();
    drop([new File(["%PDF"], "L17 RCP.pdf", { type: "application/pdf" })]);
    expect(viewerStore.getState()).toMatchObject({ status: "loading", fileName: "L17 RCP.pdf" });
    expect(screen.queryByTestId("drop-zone")).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas-viewport")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent("L17 RCP.pdf");
    expect(document.title).toBe("L17 RCP.pdf — Plan Markup");
    expect(toastStore.getState().visible).toHaveLength(0);
  });

  it("other files are refused with a warning and the workspace stays empty", () => {
    setup();
    drop([new File(["x"], "notes.txt", { type: "text/plain" })]);
    expect(toastStore.getState().visible.at(-1)).toMatchObject({
      title: "Only PDF files can be opened.",
      variant: "warning",
    });
    expect(viewerStore.getState().status).toBe("empty");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("No drawing open");
  });

  it("several files open each PDF in its own tab (the last one shown) and skip the others", () => {
    setup();
    drop([
      new File(["x"], "notes.txt", { type: "text/plain" }),
      new File(["%PDF"], "A.pdf", { type: "application/pdf" }),
      new File(["%PDF"], "B.pdf", { type: "application/pdf" }),
    ]);
    expect(viewerStore.getState().fileName).toBe("B.pdf");
    const strip = screen.getByRole("tablist", { name: "Open drawings" });
    expect(within(strip).getAllByRole("tab").map((t) => t.textContent)).toEqual(["A.pdf, loading", "B.pdf, loading"]);
    expect(toastStore.getState().visible.map((t) => t.title)).toEqual(["Only PDF files can be opened; the others were skipped."]);
  });

  it("an image-only page shows the HintBar under the toolbar; Dismiss hides it", async () => {
    const { user } = setup();
    drop([new File(["%PDF"], "scan.pdf", { type: "application/pdf" })]);
    act(() => viewerStore.setState({ status: "ready", content: { hasVector: false, hasText: false, imageOnly: true } }));
    const hint = await screen.findByTestId("hint-bar");
    expect(hint).toHaveTextContent(
      "This page is an image — snapping and scale detection are unavailable; calibrate manually",
    );
    expect(hint.closest("header")).not.toBeNull();
    await user.click(within(hint).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("hint-bar")).not.toBeInTheDocument();
  });

  it("a dismissed image-only notice stays dismissed when its tab is shown again (per tab)", async () => {
    const { user } = setup();
    drop([new File(["%PDF"], "scan.pdf", { type: "application/pdf" }), new File(["%PDF"], "plan.pdf", { type: "application/pdf" })]);
    const [scan, plan] = tabsStore.getState().tabs.map((t) => t.id);
    act(() => viewerTabs.activate(scan));
    act(() => viewerStore.setState({ status: "ready", content: { hasVector: false, hasText: false, imageOnly: true } }));
    const hint = await screen.findByTestId("hint-bar");
    await user.click(within(hint).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("hint-bar")).not.toBeInTheDocument();
    act(() => viewerTabs.activate(plan));
    act(() => viewerStore.setState({ status: "ready", content: { hasVector: false, hasText: false, imageOnly: true } }));
    // Another image-only drawing still gets its notice.
    expect(await screen.findByTestId("hint-bar")).toBeInTheDocument();
    act(() => viewerTabs.activate(scan));
    expect(screen.queryByTestId("hint-bar")).not.toBeInTheDocument();
    act(() => viewerTabs.activate(plan));
    expect(screen.getByTestId("hint-bar")).toBeInTheDocument();
  });

  it("another user's workspace does not show the previous user's drawings", () => {
    const first = setup();
    drop([new File(["%PDF"], "private.pdf", { type: "application/pdf" })]);
    expect(viewerStore.getState().fileName).toBe("private.pdf");
    first.unmount();
    render(<WorkspaceShell user={{ ...USER, id: "user-2", email: "kim@example.com" }} />);
    expect(screen.queryByRole("tablist", { name: "Open drawings" })).not.toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent("No drawing open");
    expect(viewerStore.getState().fileName).toBeNull();
  });
  it("File › Close drawing and Window › Next / Previous drawing name the Alt keys and drive the tabs", async () => {
    const { user } = setup();
    drop([new File(["%PDF"], "a.pdf", { type: "application/pdf" }), new File(["%PDF"], "b.pdf", { type: "application/pdf" })]);
    await user.click(screen.getByRole("menuitem", { name: "Window" }));
    const next = await screen.findByRole("menuitem", { name: /Next drawing/ });
    expect(next).toHaveTextContent("Alt+PageDown");
    await user.click(next);
    expect(viewerStore.getState().fileName).toBe("a.pdf");
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    const close = await screen.findByRole("menuitem", { name: /Close drawing/ });
    expect(close).toHaveTextContent("Alt+W");
    await user.click(close);
    expect(tabsStore.getState().tabs.map((t) => t.fileName)).toEqual(["b.pdf"]);
  });
  it("a file error clears the title and status bar name", () => {
    setup();
    drop([new File(["junk"], "bad.pdf", { type: "application/pdf" })]);
    act(() => viewerStore.setState({ status: "error", error: "invalid-pdf" }));
    expect(screen.getByRole("contentinfo")).toHaveTextContent("No drawing open");
    expect(document.title).not.toContain("bad.pdf");
  });

  it("a file dropped outside the drop zone does not replace the page", () => {
    setup();
    const dataTransfer = { files: [new File(["%PDF"], "a.pdf")], types: ["Files"], dropEffect: "copy" };
    const toolbar = screen.getByRole("navigation", { name: "Panels" });
    // fireEvent returns false when the default (open the file in the tab) was prevented.
    expect(fireEvent.dragOver(toolbar, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe("none");
    expect(fireEvent.drop(toolbar, { dataTransfer })).toBe(false);
    expect(toastStore.getState().visible).toHaveLength(0);
  });

  it("Open…, File › Open… and Ctrl+O all open the file picker", async () => {
    const { user } = setup();
    const input = screen.getByTestId("open-input") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await user.click(screen.getAllByRole("button", { name: "Open…" })[0]);
    fireEvent.keyDown(window, { ctrlKey: true, code: "KeyO", key: "o" });
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: /Open…/ }));
    expect(click).toHaveBeenCalledTimes(3);
  });
});

describe("view navigation (Story 3.2)", () => {
  function openDrawing() {
    act(() => {
      openDocument(new File(["%PDF"], "a.pdf", { type: "application/pdf" }));
      viewerStore.setState({ status: "ready", pageCount: 1, zoom: 64 });
    });
  }

  it("view commands are disabled without a drawing and run with one", async () => {
    const { user } = setup();
    const doc = screen.getByRole("toolbar", { name: "Document" });
    for (const name of ["Zoom in", "Zoom out", "Fit page", "Fit width", "Rotate view clockwise", "Rotate view counter-clockwise"]) {
      expect(within(doc).getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
    openDrawing();
    const zoomIn = vi.spyOn(viewerCommands, "zoomIn");
    const rotate = vi.spyOn(viewerCommands, "rotateClockwise");
    const fitWidth = vi.spyOn(viewerCommands, "fitWidth");
    for (const name of ["Zoom in", "Zoom out", "Fit page", "Fit width", "Rotate view clockwise", "Rotate view counter-clockwise"]) {
      expect(within(doc).getByRole("button", { name })).not.toHaveAttribute("aria-disabled");
    }
    await user.click(within(doc).getByRole("button", { name: "Zoom in" }));
    expect(zoomIn).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rotate view clockwise" }));
    expect(rotate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: /Fit width/ }));
    expect(fitWidth).toHaveBeenCalledTimes(1);
  });

  it("the ToolRail enables Select and Pan, shows the active tool and switches it", async () => {
    const { user } = setup();
    openDrawing();
    const rail = screen.getByRole("toolbar", { name: "Drawing tools" });
    const select = within(rail).getByRole("radio", { name: "Select" });
    const pan = within(rail).getByRole("radio", { name: "Pan" });
    expect(select).not.toHaveAttribute("aria-disabled");
    expect(select).toHaveAttribute("aria-checked", "true");
    await user.click(pan);
    expect(viewerStore.getState().tool).toBe("pan");
    expect(pan).toHaveAttribute("aria-checked", "true");
    await user.click(pan); // clicking the active tool keeps it
    expect(viewerStore.getState().tool).toBe("pan");
    // Story 5.4: Line works; 5.5: Rectangle, Ellipse and Cloud too; 5.6: Text box; 5.7: Pen and Highlight; Stamp arrives later.
    expect(within(rail).getByRole("radio", { name: "Line" })).not.toHaveAttribute("aria-disabled");
    for (const name of ["Rectangle", "Ellipse", "Cloud"]) expect(within(rail).getByRole("radio", { name })).not.toHaveAttribute("aria-disabled");
    expect(within(rail).getByRole("radio", { name: "Text box" })).not.toHaveAttribute("aria-disabled");
    expect(within(rail).getByRole("button", { name: "More text tools" })).not.toHaveAttribute("aria-disabled");
    for (const name of ["Pen", "Highlight"]) expect(within(rail).getByRole("radio", { name })).not.toHaveAttribute("aria-disabled");
    expect(within(rail).getByRole("radio", { name: "Stamp" })).toHaveAttribute("aria-disabled", "true");
  });

  it("the status bar shows, in order: file name, pager, page size, scale, snap toggles, cursor X/Y, zoom, save slot (Story 3.7)", () => {
    setup();
    openDrawing();
    // An A1 sheet, landscape (points).
    act(() => viewerStore.setState({ pages: [{ width: (841 * 72) / 25.4, height: (594 * 72) / 25.4, rotate: 0 }], pageIndex: 0 }));
    const bar = screen.getByRole("contentinfo");
    expect(bar).toHaveTextContent(/^a\.pdf.*\/ \d+.*A1 841 × 594 mm.*Scale not set.*64%/);
    const order = ["status-file", "status-page-size", "status-scale", "status-snap", "status-cursor", "status-zoom", "status-save"].map((id) =>
      within(bar).getByTestId(id),
    );
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(bar).getByRole("group", { name: "Pages" }).compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The cursor and the zoom are not in the live region (never announced).
    expect(screen.getByRole("status").contains(order[4])).toBe(false);
    expect(order[4]).toHaveAttribute("aria-live", "off");
  });

  it("the status bar holds only the empty item without a drawing", () => {
    setup();
    const bar = screen.getByRole("contentinfo");
    expect(bar).toHaveTextContent(/^No drawing open$/);
    expect(within(bar).queryByTestId("status-snap")).toBeNull();
    expect(within(bar).queryByTestId("status-cursor")).toBeNull();
  });

  it("announces the settled page once, with its sheet label, in a polite live region", () => {
    vi.useFakeTimers();
    try {
      setup();
      openDrawing();
      const live = screen.getByRole("status");
      expect(live).toHaveAttribute("aria-live", "polite");
      act(() => vi.advanceTimersByTime(ANNOUNCE_LABEL_WAIT_MS));
      expect(live).toHaveTextContent(/^Page 1 of 1$/);
      // Key repeats: the pages passed through are not announced.
      act(() => viewerStore.setState({ pageCount: 12, pageIndex: 1, pageLabels: null, sheetLabels: {} }));
      act(() => vi.advanceTimersByTime(100));
      act(() => viewerStore.setState({ pageIndex: 2 }));
      act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS));
      expect(live).toHaveTextContent(/^Page 1 of 1$/); // page 3's sheet number is still being looked up
      act(() => viewerStore.setState({ sheetLabels: { 2: "A1721" } }));
      act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS));
      expect(live).toHaveTextContent(/^Page 3 of 12, A1721$/);
      // A page label is final at once.
      act(() => viewerStore.setState({ pageIndex: 3, pageLabels: Array.from({ length: 12 }, (_, i) => (i === 3 ? "FP-204" : "")) }));
      act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS));
      expect(live).toHaveTextContent(/^Page 4 of 12, FP-204$/);
      expect(screen.getByRole("group", { name: "Pages" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the memory warning shows in the HintBar once the viewer reports pressure", async () => {
    setup();
    openDrawing();
    act(() => viewerStore.setState({ memoryPressure: true }));
    expect(await screen.findByTestId("hint-bar")).toHaveTextContent(
      "This drawing is using a lot of memory — some areas may redraw as you move",
    );
  });
});

describe("account and sign out", () => {
  it("the account menu shows the user and signs out", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Account: Sam Drafter" }));
    expect(await screen.findByText("sam@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("sends one sign-out while one is running", async () => {
    let finish = () => {};
    signOut.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = setup();
    for (let i = 0; i < 2; i++) {
      await user.click(screen.getByRole("menuitem", { name: "File" }));
      await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    }
    expect(signOut).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("a failed sign-out shows a toast and can be retried", async () => {
    signOut.mockRejectedValueOnce(new Error("network"));
    const { user } = setup();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    await waitFor(() =>
      expect(toastStore.getState().visible.at(-1)).toMatchObject({
        title: "Couldn't sign out. Try again.",
        variant: "danger",
      }),
    );
    expect(screen.getByRole("menubar", { name: "Main menu" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(2));
  });

  it("File › Sign out signs out", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});

describe("narrow banner", () => {
  it("shows below 1280 px and stays dismissed for the session", async () => {
    setViewport(1200, 800);
    const { user, unmount } = setup();
    const banner = screen.getByRole("region", { name: "Screen size notice" });
    expect(banner).toHaveTextContent("Plan Markup is designed for screens 1280 px or wider");
    await user.click(within(banner).getByRole("button", { name: "Dismiss notice" }));
    expect(screen.queryByRole("region", { name: "Screen size notice" })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(BANNER_DISMISSED_KEY)).toBe("1");
    unmount();
    render(<WorkspaceShell user={USER} />);
    expect(screen.queryByRole("region", { name: "Screen size notice" })).not.toBeInTheDocument();
  });

  it("is absent at 1280 px and wider", () => {
    setViewport(1280, 800);
    setup();
    expect(screen.queryByRole("region", { name: "Screen size notice" })).not.toBeInTheDocument();
  });
});
