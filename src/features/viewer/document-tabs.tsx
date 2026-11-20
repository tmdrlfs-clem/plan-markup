"use client";

import { FileWarning, Save, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { useStore } from "zustand";

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { toAriaKeyShortcuts } from "@/components/ui/shortcut";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { TAB_SHORTCUTS, resolveTabKey } from "@/core/documents/tabs";

import { tabsStore, viewerTabs, type DocumentTab } from "./viewer-tabs";

const CANVAS_SELECTOR = "[data-testid='drawing-canvas']";
/** The workspace's canvas region (`main`): it keeps the focus once the last tab has closed. */
const CANVAS_REGION_SELECTOR = "[data-region='canvas']";
/** The keys of a focused tab, for assistive technology (the close button is mouse-only). */
const TRIGGER_KEYS = toAriaKeyShortcuts("Alt+PageDown Alt+PageUp Alt+W Del", false);

/** Moves the focus to the active tab's trigger (after a switch or a close from the strip). */
function focusActiveTrigger(list: HTMLElement | null): void {
  const id = tabsStore.getState().activeId;
  if (!list || !id) return;
  list.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus();
}

/** After a close: the active tab when one is left, else the canvas region (the focus never drops to the page). */
function focusAfterClose(list: HTMLElement | null, fromStrip: boolean): void {
  if (tabsStore.getState().tabs.length === 0) {
    document.querySelector<HTMLElement>(CANVAS_REGION_SELECTOR)?.focus();
  } else if (fromStrip) {
    focusActiveTrigger(list);
  }
}

/**
 * The document tabs above the canvas (Story 3.5, FR18): one per open drawing,
 * named by its file name (full name in the tooltip), a thin progress bar while
 * it loads, a quiet error marker when it failed. Arrows move between tabs
 * (automatic activation). With the canvas or the strip focused (or nothing),
 * Alt+PageDown / Alt+PageUp cycle and Alt+W closes the active tab; the Ctrl
 * keys (Ctrl+PageDown / Ctrl+PageUp / Ctrl+F4) work too where the browser
 * passes them on. Delete on a tab, the close button and a middle click close
 * that tab. `children` is the active tab's panel.
 */
export function DocumentTabs({ children, onSaveAs }: { children: ReactNode; onSaveAs?: (tabId: string) => void }) {
  const tabs = useStore(tabsStore, (s) => s.tabs);
  const activeId = useStore(tabsStore, (s) => s.activeId);
  const listRef = useRef<HTMLDivElement>(null);

  // Tab keys with the canvas or the strip focused, or nothing focused (AC 2, AC 4).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      const inStrip = target !== null && listRef.current?.contains(target) === true;
      const onPage = target === null || target === document.body || target === document.documentElement;
      if (!inStrip && !onPage && !target?.matches(CANVAS_SELECTOR)) return;
      const action = resolveTabKey(event);
      if (!action) return;
      event.preventDefault();
      if (event.repeat && action.type === "close") return;
      if (action.type === "cycle") {
        viewerTabs.cycle(action.direction);
        if (inStrip) focusActiveTrigger(listRef.current);
        return;
      }
      viewerTabs.requestClose(inStrip ? (target?.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId ?? activeTabId()) : activeTabId());
      focusAfterClose(listRef.current, inStrip);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The active tab stays in view in a strip that scrolls (a switch by key from the canvas).
  useEffect(() => {
    if (!activeId) return;
    const trigger = listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`);
    trigger?.closest<HTMLElement>("[data-tab-item]")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  if (tabs.length === 0 || activeId === null) return <>{children}</>;
  return (
    <Tabs value={activeId} onValueChange={(id) => viewerTabs.activate(id)} className="flex h-full min-h-0 flex-col">
      <TabsList
        ref={listRef}
        aria-label="Open drawings"
        data-testid="document-tabs"
        className="shrink-0 gap-0 overflow-x-auto bg-surface-2 px-1"
      >
        {tabs.map((tab) => (
          <DocumentTabItem key={tab.id} tab={tab} active={tab.id === activeId} list={listRef} onSaveAs={onSaveAs} />
        ))}
      </TabsList>
      {/* The panel is the shared canvas: no extra tab stop around it. */}
      <TabsContent value={activeId} tabIndex={-1} className="relative min-h-0 flex-1 pt-0! outline-none">
        {children}
      </TabsContent>
    </Tabs>
  );
}

const activeTabId = () => tabsStore.getState().activeId ?? "";

function DocumentTabItem({
  tab,
  active,
  list,
  onSaveAs,
}: {
  tab: DocumentTab;
  active: boolean;
  list: RefObject<HTMLDivElement | null>;
  onSaveAs?: (tabId: string) => void;
}) {
  const loading = tab.status === "loading";
  const close = () => {
    const hadFocus = list.current?.contains(document.activeElement) === true;
    viewerTabs.requestClose(tab.id);
    focusAfterClose(list.current, hadFocus);
  };
  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Delete" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    close();
  }
  function onAuxClick(event: MouseEvent) {
    if (event.button !== 1) return;
    event.preventDefault();
    close();
  }
  // Only tabs are owned by the tablist in the accessibility tree: the close button and the
  // loading bar are mouse-only visuals (the tab's name says ", loading"; Delete / Alt+W close).
  // A right-click (or Shift+F10 on the tab) opens the tab's menu: Save as… (a PDF to this computer).
  return (
    <ContextMenu>
      {/* No tabindex on the wrapper: the tablist owns only its tabs (axe aria-required-children). */}
      <ContextMenuTrigger asChild tabIndex={undefined}>
        <div
          data-tab-item=""
          className={cx("group relative flex max-w-[220px] min-w-0 shrink-0 items-center", active ? "bg-surface-0" : "hover:bg-surface-3")}
          // A middle click closes; its mousedown would start the browser's autoscroll.
          onMouseDown={(event) => event.button === 1 && event.preventDefault()}
          onAuxClick={onAuxClick}
        >
          <Tooltip content={tab.fileName}>
            <TabsTrigger
              value={tab.id}
              data-tab-id={tab.id}
              data-status={tab.failed ? "error" : tab.status}
              aria-keyshortcuts={TRIGGER_KEYS}
              onKeyDown={onKeyDown}
              className="flex min-w-0 items-center gap-1.5 pr-8"
            >
              {tab.failed ? <FileWarning aria-hidden="true" size={14} className="shrink-0 text-danger" /> : null}
              <span className="truncate">{tab.title}</span>
              {loading ? <span className="sr-only">, loading</span> : null}
              {tab.failed ? <span className="sr-only">, could not be opened</span> : null}
            </TabsTrigger>
          </Tooltip>
          <IconButton
            label={`Close ${tab.fileName}`}
            icon={X}
            // Alt+W closes the active tab: shown on the active tab's button only.
            shortcut={active ? TAB_SHORTCUTS.close : undefined}
            tabIndex={-1}
            aria-hidden="true"
            data-testid="close-tab"
            onClick={close}
            className="absolute right-1 h-6 w-6"
          />
          {loading ? (
            <div aria-hidden="true" data-testid="tab-progress" className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-accent-soft">
              <div className="h-full w-1/3 bg-accent motion-safe:animate-progress" />
            </div>
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${tab.fileName} menu`}>
        <ContextMenuItem icon={Save} shortcut="Ctrl+Shift+S" disabled={!onSaveAs || tab.failed || loading} onSelect={() => onSaveAs?.(tab.id)}>
          Save as…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
