"use client";

import { useCallback, useEffect, useMemo, useRef, useTransition, type RefObject } from "react";
import { unstable_rethrow } from "next/navigation";
import { useStore } from "zustand";

import { HintBar } from "@/components/ui/hint-bar";
import { Panel } from "@/components/ui/panel";
import { Toaster } from "@/components/ui/toast";
import { toast } from "@/components/ui/toast-store";
import { TooltipProvider } from "@/components/ui/tooltip";
import { signOut } from "@/features/account/actions";
import { pageIdOf } from "@/core/calibration/calibration";
import { CalibrateDialog, ScalePrompt, VerifyDialog, openCalibrate, useCalibrationPrefsPersistence } from "@/features/calibration";
import { redoActive, setRevisionAuthor, undoActive } from "@/features/editor";
import { useFirstUseTipsPersistence } from "@/features/tips";
import { chooseTheme, useWorkspaceTheme } from "@/features/appearance/theme-store";
import { LayersPanel, MarkupContextMenu, MarkupsListPanel, MeasurementsPanel, PropertiesPanel, TextEditor, armArea, armCount, armLength, armPolylength, useEditorSession, useMeasureTools } from "@/features/editor";
import {
  DocumentTabs,
  DocumentViewer,
  PagePager,
  SearchPanel,
  ThumbnailsPanel,
  activeSearch,
  hasDocument,
  requestSearchFocus,
  scaleStateOf,
  usePageAnnouncement,
  useSnapSettingsPersistence,
  viewerStore,
  viewerTabs,
} from "@/features/viewer";

import { AccountMenu, displayName, type WorkspaceUser } from "./account-menu";
import { AddToolDialog } from "@/features/tool-chest/add-tool-dialog";
import { ImportReportDialog } from "@/features/tool-chest/import-btx-ui";
import { ToolChestPanel, setToolChestOwner } from "@/features/tool-chest/tool-chest-panel";

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
import { SignatureDialog, openSignatureDialog } from "@/features/signature/signature-dialog";
import {
  MarkupSetListDialog,
  OpenMarkupSetDialog,
  openRecentSet,
  useBlankPagesHint,
  useOtherVersionHint,
  useRecentSets,
} from "@/features/markup-set/markup-sets-ui";
import { useMarkupSetSync } from "@/features/markup-set/sync";

import { WorkspaceMenuBar } from "./workspace-menu-bar";
import { WorkspaceStatusBar } from "./workspace-status-bar";
import { WorkspaceToolbar } from "./workspace-toolbar";
import type { Theme } from "@/lib/theme";

export type { WorkspaceUser } from "./account-menu";

/**
 * Workspace frame (UX-DR5): menu bar, two toolbar rows, left icon rail + panel, canvas,
 * right tool rail, bottom Markups panel and status bar. `data-region` marks the F6 stops.
 */
export function WorkspaceShell({ user, theme = null }: { user: WorkspaceUser; theme?: Theme | null }) {
  // The open drawings belong to the signed-in user: another user's workspace starts empty.
  // In render, before the canvas mounts and would reopen the previous user's tabs.
  useMemo(() => {
    viewerTabs.setOwner(user.id);
    setToolChestOwner(user.id);
  }, [user.id]);
  // Story 7.7: a new revision stamp's author.
  useMemo(() => setRevisionAuthor(displayName(user)), [user]);
  // Story 4.5: the editing session (markups, calibrations, undo) of this user's documents survives a reload.
  useEditorSession(user.id);
  useMarkupSetSync(user.id);
  // Story 6.5: markups on another version of the shown file.
  useOtherVersionHint();
  // Story 6.6: a set's markups shown on blank pages.
  useBlankPagesHint();
  // Stories 4.5 / 4.6: the measuring tools paint and place through the viewer's markup layers.
  useMeasureTools();
  return (
    <LayoutProvider userId={user.id}>
      <TooltipProvider>
        <ShellBody user={user} initialTheme={theme} />
        <Toaster />
        <MarkupSetListDialog />
        <OpenMarkupSetDialog />
      </TooltipProvider>
    </LayoutProvider>
  );
}

function LeftPanelBody() {
  const panel = useLayout((s) => leftPanel(s.left.active));
  if (panel.id === "tool-chest") return <ToolChestPanel />;
  if (panel.id === "thumbnails") return <ThumbnailsPanel emptyText={panel.empty} />;
  if (panel.id === "search") return <SearchPanel emptyText={panel.empty} />;
  // Story 4.11: measurements grouped by type with totals.
  if (panel.id === "measurements") return <MeasurementsPanel emptyText={panel.empty} noDrawingText="No drawing open" />;
  // Story 5.10: the selected markups' properties and the format painter.
  if (panel.id === "properties") return <PropertiesPanel emptyText={panel.empty} />;
  // Story 5.12: the document's layers.
  if (panel.id === "layers") return <LayersPanel emptyText={panel.empty} />;
  return (
    <div className="flex flex-col gap-1 p-3 text-ws-md">
      <p>{panel.empty}</p>
      {panel.hint ? <p className="text-ws-sm text-muted">{panel.hint}</p> : null}
    </div>
  );
}

function ShellBody({ user, initialTheme }: { user: WorkspaceUser; initialTheme: Theme | null }) {
  // Story 3.8: the profile's theme is rendered by the server (no flash); a choice applies at once.
  const theme = useWorkspaceTheme(initialTheme);
  const left = useLayout((s) => s.left);
  const bottom = useLayout((s) => s.bottom);
  const setLeftCollapsed = useLayout((s) => s.setLeftCollapsed);
  const setLeftSize = useLayout((s) => s.setLeftSize);
  const showLeftPanel = useLayout((s) => s.showLeftPanel);
  const openLeftPanel = useLayout((s) => s.openLeftPanel);
  const setBottomCollapsed = useLayout((s) => s.setBottomCollapsed);
  const toggleBottomCollapsed = useLayout((s) => s.toggleBottomCollapsed);
  const setBottomSize = useLayout((s) => s.setBottomSize);
  const hideAllPanels = useLayout((s) => s.hideAllPanels);

  const viewerStatus = useStore(viewerStore, (s) => s.status);
  // Story 6.6: the newest markup sets, listed while no drawing is open.
  const recentSets = useRecentSets(viewerStatus === "empty");
  const fileName = useStore(viewerStore, (s) => s.fileName);
  const zoom = useStore(viewerStore, (s) => s.zoom);
  // The shown page's facts for the status bar (Story 3.7): they follow the active tab and page.
  const shownPage = useStore(viewerStore, (s) => (hasDocument(s) ? (s.pages[s.pageIndex] ?? null) : null));
  // Story 4.2: the shown page's printed scales (absent until detected).
  const shownScales = useStore(viewerStore, (s) => (hasDocument(s) ? (s.pageScales[s.pageIndex] ?? null) : null));
  // Story 4.3: the shown page's calibration (by stable page id).
  const shownCalibration = useStore(viewerStore, (s) =>
    hasDocument(s) && s.documentId ? (s.calibrations[pageIdOf(s.documentId, s.pageIndex)] ?? null) : null,
  );
  useSnapSettingsPersistence(user.id);
  useCalibrationPrefsPersistence(user.id);
  useFirstUseTipsPersistence(user.id);
  const announcement = usePageAnnouncement();

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
  // Ctrl+F opens Search with its field focused; F3 / Shift+F3 step through the results (Story 3.6).
  const search = useCallback(() => {
    openLeftPanel("search");
    requestSearchFocus();
  }, [openLeftPanel]);
  const searchStep = useCallback(
    (direction: 1 | -1) => {
      const current = activeSearch.getState().search;
      if (!current || current.store.getState().query.trim() === "") return;
      openLeftPanel("search");
      current.step(direction);
    },
    [openLeftPanel],
  );
  // Without a drawing the browser keeps Ctrl+F and F3 (founder decision 2026-10-24).
  const drawingOpen = useStore(viewerStore, hasDocument);
  useWorkspaceShortcuts({
    open,
    showLeftPanel,
    toggleMarkupsList: toggleBottomCollapsed,
    hideAllPanels,
    search: drawingOpen ? search : undefined,
    searchStep: drawingOpen ? searchStep : undefined,
    // Story 4.3: the active drawing's undo history.
    undo: drawingOpen ? undoActive : undefined,
    redo: drawingOpen ? redoActive : undefined,
    // Story 4.5: Shift+Alt+L, the Length measurement.
    lengthTool: drawingOpen ? armLength : undefined,
    // Story 4.6: Shift+Alt+Q, the Polylength measurement.
    polylengthTool: drawingOpen ? armPolylength : undefined,
    // Story 4.8: Shift+Alt+A Area, Shift+Alt+C Count.
    areaTool: drawingOpen ? armArea : undefined,
    countTool: drawingOpen ? armCount : undefined,
  });

  const panel = leftPanel(left.active);

  return (
    <div data-theme={theme} data-testid="workspace-root" className="flex h-dvh flex-col overflow-hidden bg-surface-0 text-text">
      <NarrowBanner />
      <header className="shrink-0 bg-surface-2">
        <div data-region="menu-bar" className="flex items-center border-b border-border pr-1">
          <WorkspaceMenuBar onOpen={open} onSignOut={handleSignOut} theme={theme} onThemeChange={(next) => void chooseTheme(next, theme)} onAccount={openSignatureDialog} />
          <div className="ml-auto">
            <AccountMenu user={user} onSignOut={handleSignOut} />
          </div>
          {/* Story 5.13: Settings > Account & signature. */}
          <SignatureDialog name={user.name} email={user.email} />
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
        <main data-region="canvas" tabIndex={-1} className="relative min-w-0 flex-1 bg-surface-0 focus-ring">
          {viewerStatus === "empty" ? (
            <EmptyWorkspace onOpen={open} onOpenFiles={openFiles} recent={recentSets} onOpenRecent={openRecentSet} />
          ) : (
            <DocumentTabs>
              <DocumentViewer onOpen={open} onOpenFiles={openFiles} overlay={<TextEditor />} />
            </DocumentTabs>
          )}
          {/* Story 4.7: a measuring tool on a page with no scale offers the detected scale or Calibrate (under the tabs). */}
          <ScalePrompt />
          {/* Story 5.3: the markups' context menu (a right-click with Select). */}
          <MarkupContextMenu />
          <AddToolDialog />
          <ImportReportDialog />
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
          <MarkupsListPanel author={displayName(user)} />
        </Panel>
      </div>

      {/* tabIndex -1: F6 can land here while the bar has no actionable items. No fixed height:
          the 24 px bar plus the border (as in the menu bar row). */}
      <footer
        data-region="status-bar"
        tabIndex={-1}
        className="shrink-0 border-t border-border bg-surface-2 focus-ring"
      >
        <WorkspaceStatusBar
          fileName={viewerStatus === "error" ? null : fileName}
          zoom={zoom}
          pager={<PagePager />}
          announcement={announcement}
          page={shownPage}
          scale={shownPage ? scaleStateOf(shownScales, shownCalibration, shownPage.rotate) : null}
          calibration={shownCalibration}
          onCalibrate={() => openCalibrate()}
        />
      </footer>
      <CalibrateDialog />
      <VerifyDialog />

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
