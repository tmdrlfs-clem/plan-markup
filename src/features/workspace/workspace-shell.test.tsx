// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hintStore } from "@/components/ui/hint-store";
import { resetToasts, toastStore } from "@/components/ui/toast-store";
import { openDocument, resetViewer, viewerCommands, viewerStore } from "@/features/viewer";

import { storageKey } from "./layout-persistence";
import { BANNER_DISMISSED_KEY } from "./narrow-banner";
import { WorkspaceShell } from "./workspace-shell";

const signOut = vi.fn<() => Promise<void>>(async () => {});
vi.mock("@/features/account/actions", () => ({ signOut: () => signOut() }));

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
    expect(tools.length).toBe(16);
    for (const tool of tools) expect(tool).toHaveAttribute("aria-disabled", "true");
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

  it("several files open the first PDF and say tabs are coming", () => {
    setup();
    drop([
      new File(["x"], "notes.txt", { type: "text/plain" }),
      new File(["%PDF"], "A.pdf", { type: "application/pdf" }),
      new File(["%PDF"], "B.pdf", { type: "application/pdf" }),
    ]);
    expect(viewerStore.getState().fileName).toBe("A.pdf");
    expect(toastStore.getState().visible.map((t) => t.title)).toEqual(["Tabs arrive soon — opened A.pdf"]);
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
    expect(within(rail).getByRole("radio", { name: "Line" })).toHaveAttribute("aria-disabled", "true");
  });

  it("the status bar shows the file name, the pager, then the zoom", () => {
    setup();
    openDrawing();
    expect(screen.getByRole("contentinfo")).toHaveTextContent(/^a\.pdf.*\/ \d+.*64%/);
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
