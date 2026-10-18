"use client";

import { useCallback, useRef, useTransition } from "react";

import { Panel } from "@/components/ui/panel";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { signOut } from "@/features/account/actions";

import { AccountMenu, type WorkspaceUser } from "./account-menu";
import { EmptyWorkspace } from "./empty-workspace";
import { LayoutProvider, useLayout } from "./layout-context";
import { BOTTOM_SIZE, LEFT_SIZE } from "./layout-persistence";
import { NarrowBanner } from "./narrow-banner";
import { openFiles } from "./open-files";
import { PanelRail } from "./panel-rail";
import { MARKUPS_LIST, leftPanel } from "./panel-registry";
import { ToolRail } from "./tool-rail";
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
  const setBottomSize = useLayout((s) => s.setBottomSize);
  const hideAllPanels = useLayout((s) => s.hideAllPanels);

  const fileInput = useRef<HTMLInputElement>(null);
  const open = useCallback(() => fileInput.current?.click(), []);
  const [, startTransition] = useTransition();
  const handleSignOut = () =>
    startTransition(async () => {
      await signOut();
    });

  useRegionCycling();
  useWorkspaceShortcuts({
    open,
    showLeftPanel,
    toggleMarkupsList: () => setBottomCollapsed(!bottom.collapsed),
    hideAllPanels,
  });

  const panel = leftPanel(left.active);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-0 text-text">
      <NarrowBanner />
      <header className="shrink-0 bg-surface-2">
        <div data-region="menu-bar" className="flex h-6 items-center border-b border-border pr-1">
          <WorkspaceMenuBar onOpen={open} onSignOut={handleSignOut} />
          <div className="ml-auto">
            <AccountMenu user={user} onSignOut={handleSignOut} />
          </div>
        </div>
        <div data-region="toolbar">
          <WorkspaceToolbar onOpen={open} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Panels" data-region="panel-rail" className="w-11 shrink-0 border-r border-border bg-surface-2">
          <PanelRail />
        </nav>
        {left.collapsed ? null : (
          <div data-region="left-panel" className="flex min-h-0 shrink-0 border-r border-border">
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
          <EmptyWorkspace onOpen={open} onOpenFiles={openFiles} recent={[]} />
        </main>
        <aside aria-label="Tools" data-region="tool-rail" className="w-11 shrink-0 border-l border-border bg-surface-2">
          <ToolRail />
        </aside>
      </div>

      <div data-region="bottom-panel" className="shrink-0 border-t border-border">
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

      {/* tabIndex -1: F6 can land here while the bar has no actionable items. */}
      <footer
        data-region="status-bar"
        tabIndex={-1}
        className="h-6 shrink-0 border-t border-border bg-surface-2 focus-ring"
      >
        <WorkspaceStatusBar />
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
