"use client";

import { FileWarning, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { useStore } from "zustand";

import { cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { resolveTabKey } from "@/core/documents/tabs";

import { tabsStore, viewerTabs, type DocumentTab } from "./viewer-tabs";

const CANVAS_SELECTOR = "[data-testid='drawing-canvas']";

/** Moves the focus to the active tab's trigger (after a switch or a close from the strip). */
function focusActiveTrigger(list: HTMLElement | null): void {
  const id = tabsStore.getState().activeId;
  if (!list || !id) return;
  list.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus();
}

/**
 * The document tabs above the canvas (Story 3.5, FR18): one per open drawing,
 * named by its sheet number or file name (full name in the tooltip), a thin
 * progress bar while it loads, a quiet error marker when it failed. Arrows move
 * between tabs (automatic activation); Ctrl+PageDown / Ctrl+PageUp (or Alt+…)
 * with the canvas or the strip focused cycle; Ctrl+F4, Delete on a tab, the
 * close button and a middle click close. `children` is the active tab's panel.
 */
export function DocumentTabs({ children }: { children: ReactNode }) {
  const tabs = useStore(tabsStore, (s) => s.tabs);
  const activeId = useStore(tabsStore, (s) => s.activeId);
  const listRef = useRef<HTMLDivElement>(null);

  // Tab keys with the canvas or the strip focused (AC 2, AC 4).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      const inStrip = target !== null && listRef.current?.contains(target) === true;
      if (!inStrip && !target?.matches(CANVAS_SELECTOR)) return;
      const action = resolveTabKey(event);
      if (!action) return;
      event.preventDefault();
      if (event.repeat && action.type === "close") return;
      if (action.type === "cycle") viewerTabs.cycle(action.direction);
      else viewerTabs.close(inStrip ? (target?.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId ?? activeTabId()) : activeTabId());
      if (inStrip) focusActiveTrigger(listRef.current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
          <DocumentTabItem key={tab.id} tab={tab} active={tab.id === activeId} list={listRef} />
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

function DocumentTabItem({ tab, active, list }: { tab: DocumentTab; active: boolean; list: RefObject<HTMLDivElement | null> }) {
  const loading = tab.status === "loading";
  const close = () => {
    const hadFocus = list.current?.contains(document.activeElement) === true;
    viewerTabs.close(tab.id);
    if (hadFocus) focusActiveTrigger(list.current);
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
  return (
    <div
      className={cx("group relative flex max-w-[220px] min-w-0 items-center", active ? "bg-surface-0" : "hover:bg-surface-3")}
      // A middle click closes; its mousedown would start the browser's autoscroll.
      onMouseDown={(event) => event.button === 1 && event.preventDefault()}
      onAuxClick={onAuxClick}
    >
      <Tooltip content={tab.fileName}>
        <TabsTrigger
          value={tab.id}
          data-tab-id={tab.id}
          data-status={tab.failed ? "error" : tab.status}
          onKeyDown={onKeyDown}
          className="flex min-w-0 items-center gap-1.5 pr-8"
        >
          {tab.failed ? <FileWarning aria-hidden="true" size={14} className="shrink-0 text-danger" /> : null}
          <span className="num truncate">{tab.title}</span>
          {loading ? <span className="sr-only">, loading</span> : null}
          {tab.failed ? <span className="sr-only">, could not be opened</span> : null}
        </TabsTrigger>
      </Tooltip>
      <IconButton
        label={`Close ${tab.fileName}`}
        icon={X}
        tabIndex={-1}
        onClick={close}
        className="absolute right-1 h-6 w-6"
      />
      {loading ? (
        <div role="progressbar" aria-label={`Loading ${tab.fileName}`} className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-accent-soft">
          <div className="h-full w-1/3 bg-accent motion-safe:animate-progress" />
        </div>
      ) : null}
    </div>
  );
}
