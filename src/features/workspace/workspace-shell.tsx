"use client";

import { useCallback, useEffect, useRef, useTransition, type RefObject } from "react";
import { unstable_rethrow } from "next/navigation";
import { useStore } from "zustand";

import { HintBar } from "@/components/ui/hint-bar";
import { Panel } from "@/components/ui/panel";
import { Toaster } from "@/components/ui/toast";
import { toast } from "@/components/ui/toast-store";
import { TooltipProvider } from "@/components/ui/tooltip";
import { signOut } from "@/features/account/actions";
import { DocumentViewer, viewerStore } from "@/features/viewer";

import { AccountMenu, type WorkspaceUser } from "./account-menu";
import { EmptyWorkspace } from "./empty-workspace";
import { LayoutProvider, useLayout, useLayoutStore } from "./layout-context";
import { BOTTOM_SIZE, LEFT_SIZE } from "./layout-persistence";
import { NarrowBanner } from "./narrow-banner";
import { openFiles } from "./open-files";
import { PanelRail } from "./panel-rail";
import { MARKUPS_LIST, leftPanel } from "./panel-registry";
import { ToolRail } from "./tool-rail";
import { useFileDropGuard } from "./use-file-drop-guard";
import { useRegionCycling } from "./use-region-cycling";
import { useWorkspaceShortcuts } from "./use-workspace-shortcuts";
import { WorkspaceMenuBar } from "./workspace-menu-bar";
import { WorkspaceStatusBar } from "./workspace-status-bar";
import { WorkspaceToolbar } from "./workspace-toolbar";

export type { WorkspaceUser } from "./account-menu";

/**
 * Workspace frame (UX-DR5): menu bar, two toolbar rows, left icon rail + panel, canvas,
 * right tool rail, bottom Markups panel and status bar. `data-region` marks the F6 stops.
 */
export function WorkspaceShell({ user }: { user: WorkspaceUser }) {
  return (
    <LayoutProvider userId={user.id}>
      <TooltipProvider>
        <ShellBody user={user} />
        <Toaster />
      </TooltipProvider>
    </LayoutProvider>
  );
}

function LeftPanelBody() {
  const panel = useLayout((s) => leftPanel(s.left.active));
  return (
    <div className="flex flex-col gap-1 p-3 text-ws-md">
      <p>{panel.empty}</p>
      {panel.hint ? <p className="text-ws-sm text-muted">{panel.hint}</p> : null}
    </div>
  );
}

function ShellBody({ user }: { user: WorkspaceUser }) {
  const left = useLayout((s) => s.left);
  const bottom = useLayout((s) => s.bottom);
  const setLeftCollapsed = useLayout((s) => s.setLeftCollapsed);
  const setLeftSize = useLayout((s) => s.setLeftSize);
  const showLeftPanel = useLayout((s) => s.showLeftPanel);
  const setBottomCollapsed = useLayout((s) => s.setBottomCollapsed);
  const toggleBottomCollapsed = useLayout((s) => s.toggleBottomCollapsed);
  const setBottomSize = useLayout((s) => s.setBottomSize);
  const hideAllPanels = useLayout((s) => s.hideAllPanels);

  const viewerStatus = useStore(viewerStore, (s) => s.status);
  const fileName = useStore(viewerStore, (s) => s.fileName);

  const fileInput = useRef<HTMLInputElement>(null);
  const open = useCallback(() => fileInput.current?.click(), []);
  const [signingOut, startTransition] = useTransition();
  // isPending only updates on the next render; the ref also stops a second click in the same frame.
  const signOutStarted = useRef(false);
  const handleSignOut = () => {
    if (signingOut || signOutStarted.current) return;
    signOutStarted.current = true;
    startTransition(async () => {
      try {
        await signOut();
      } catch (error) {
        unstable_rethrow(error);
        signOutStarted.current = false;
        toast({ title: "Couldn't sign out. Try again.", variant: "danger" });
      }
    });
  };

  const leftRegion = useRef<HTMLDivElement>(null);
  const bottomRegion = useRef<HTMLDivElement>(null);
  const panelRail = useRef<HTMLElement>(null);
  useFocusRescue(leftRegion, bottomRegion, panelRail);

  useRegionCycling();
  useFileDropGuard();
  useWorkspaceShortcuts({ open, showLeftPanel, toggleMarkupsList: toggleBottomCollapsed, hideAllPanels });

  const panel = leftPanel(left.active);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-0 text-text">
      <NarrowBanner />
      <header className="shrink-0 bg-surface-2">
        <div data-region="menu-bar" className="flex items-center border-b border-border pr-1">
          <WorkspaceMenuBar onOpen={open} onSignOut={handleSignOut} />
          <div className="ml-auto">
            <AccountMenu user={user} onSignOut={handleSignOut} />
          </div>
        </div>
        <div data-region="toolbar">
          <WorkspaceToolbar onOpen={open} />
        </div>
        {/* File-level notices sit in the flow under toolbar row 2, never over the canvas. */}
        <HintBar />
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          ref={panelRail}
          aria-label="Panels"
          data-region="panel-rail"
          className="w-11 shrink-0 border-r border-border bg-surface-2"
        >
          <PanelRail />
        </nav>
        {left.collapsed ? null : (
          <div ref={leftRegion} data-region="left-panel" className="flex min-h-0 shrink-0 border-r border-border">
            <Panel
              title={panel.title}
              side="left"
              role="complementary"
              collapsed={false}
              onCollapsedChange={setLeftCollapsed}
              size={left.size}
              onSizeChange={setLeftSize}
              minSize={LEFT_SIZE.min}
              maxSize={LEFT_SIZE.max}
            >
              <LeftPanelBody />
            </Panel>
          </div>
        )}
        <main data-region="canvas" tabIndex={-1} className="min-w-0 flex-1 bg-surface-0 focus-ring">
          {viewerStatus === "empty" ? (
            <EmptyWorkspace onOpen={open} onOpenFiles={openFiles} recent={[]} />
          ) : (
            <DocumentViewer onOpen={open} onOpenFiles={openFiles} />
          )}
        </main>
        <aside aria-label="Tools" data-region="tool-rail" className="w-11 shrink-0 border-l border-border bg-surface-2">
          <ToolRail />
        </aside>
      </div>

      {/* Collapsed, only the header shows: Tab reaches its Expand button, F6 skips it (AC 5). */}
      <div
        ref={bottomRegion}
        data-region={bottom.collapsed ? undefined : "bottom-panel"}
        className="shrink-0 border-t border-border"
      >
        <Panel
          title={MARKUPS_LIST.title}
          side="bottom"
          role="complementary"
          collapsed={bottom.collapsed}
          onCollapsedChange={setBottomCollapsed}
          size={bottom.size}
          onSizeChange={setBottomSize}
          minSize={BOTTOM_SIZE.min}
          maxSize={BOTTOM_SIZE.max}
        >
          <p className="p-3 text-ws-md text-muted">Markups you add appear here.</p>
        </Panel>
      </div>

      {/* tabIndex -1: F6 can land here while the bar has no actionable items. No fixed height:
          the 24 px bar plus the border (as in the menu bar row). */}
      <footer
        data-region="status-bar"
        tabIndex={-1}
        className="shrink-0 border-t border-border bg-surface-2 focus-ring"
      >
        <WorkspaceStatusBar fileName={viewerStatus === "error" ? null : fileName} />
      </footer>

      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        data-testid="open-input"
        onChange={(event) => {
          openFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * A collapsing panel takes the focused element with it (the left panel unmounts, the bottom
 * body is hidden). Zustand notifies before React re-renders, so the focus is still inside:
 * move it to the panel's rail button or to the bottom panel's Expand button.
 */
function useFocusRescue(
  leftRegion: RefObject<HTMLDivElement | null>,
  bottomRegion: RefObject<HTMLDivElement | null>,
  panelRail: RefObject<HTMLElement | null>,
): void {
  const store = useLayoutStore();
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        const active = document.activeElement;
        if (state.left.collapsed && !previous.left.collapsed && leftRegion.current?.contains(active)) {
          const rail = panelRail.current;
          rail?.querySelector<HTMLElement>(`[data-panel-id="${previous.left.active}"]`)?.focus();
        }
        const bottom = bottomRegion.current;
        if (state.bottom.collapsed && !previous.bottom.collapsed && bottom?.contains(active)) {
          if (!bottom.querySelector("header")?.contains(active)) {
            bottom.querySelector<HTMLElement>("header button[aria-expanded]")?.focus();
          }
        }
      }),
    [store, leftRegion, bottomRegion, panelRail],
  );
}
