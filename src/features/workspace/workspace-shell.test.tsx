// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetToasts, toastStore } from "@/components/ui/toast-store";

import { storageKey } from "./layout-persistence";
import { BANNER_DISMISSED_KEY } from "./narrow-banner";
import { WorkspaceShell } from "./workspace-shell";

const signOut = vi.fn(async () => {});
vi.mock("@/features/account/actions", () => ({ signOut: () => signOut() }));

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
    expect(screen.getByRole("status")).toHaveTextContent("No drawing open");
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
    expect(zone).not.toHaveAttribute("data-dragging");
  }

  it("a dropped PDF shows the placeholder toast; other files are refused", () => {
    setup();
    drop([new File(["%PDF"], "L17 RCP.pdf", { type: "application/pdf" })]);
    expect(toastStore.getState().visible.map((t) => t.title)).toEqual(["Opening drawings arrives with the viewer."]);
    drop([new File(["x"], "notes.txt", { type: "text/plain" })]);
    expect(toastStore.getState().visible.at(-1)).toMatchObject({
      title: "Only PDF files can be opened.",
      variant: "warning",
    });
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

describe("account and sign out", () => {
  it("the account menu shows the user and signs out", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Account: Sam Drafter" }));
    expect(await screen.findByText("sam@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
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
