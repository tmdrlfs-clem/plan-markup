"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type KeyboardEvent } from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";

import { cx } from "./cx";
import { createMenuParts, type MenuPrimitive } from "./menu-parts";

const parts = createMenuParts(ContextMenuPrimitive as unknown as MenuPrimitive);

export const ContextMenu = ContextMenuPrimitive.Root;

/** Browsers that fire their own `contextmenu` for the key (e.g. on keyup) would reopen the menu. */
const NATIVE_FOLLOW_UP_MS = 1000;

/** Our own events are never swallowed, including one from a second key press inside the window. */
const syntheticEvents = new WeakSet<Event>();

function swallowNativeContextMenu(doc: Document, synthetic: Event) {
  syntheticEvents.add(synthetic);
  const block = (event: Event) => {
    if (syntheticEvents.has(event)) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
  };
  const stop = () => {
    clearTimeout(timer);
    doc.removeEventListener("contextmenu", block, true);
  };
  const timer = setTimeout(stop, NATIVE_FOLLOW_UP_MS);
  doc.addEventListener("contextmenu", block, true);
}

/**
 * Right-click opens the menu (Radix). The trigger is focusable and also opens on
 * Shift+F10 / the ContextMenu key, which jsdom and some browsers do not turn into
 * a `contextmenu` event on their own.
 */
export const ContextMenuTrigger = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>
>(function ContextMenuTrigger({ className, onKeyDown, ...props }, ref) {
  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const isShiftF10 = event.key === "F10" && event.shiftKey;
    if (!isShiftF10 && event.key !== "ContextMenu") return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const synthetic = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    swallowNativeContextMenu(event.currentTarget.ownerDocument, synthetic);
    event.currentTarget.dispatchEvent(synthetic);
  }

  return (
    <ContextMenuPrimitive.Trigger
      ref={ref}
      tabIndex={0}
      className={cx("focus-ring", className)}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
});

export const ContextMenuContent = parts.Content;
export const ContextMenuItem = parts.Item;
export const ContextMenuCheckboxItem = parts.CheckboxItem;
export const ContextMenuRadioGroup = parts.RadioGroup;
export const ContextMenuRadioItem = parts.RadioItem;
export const ContextMenuSeparator = parts.Separator;
export const ContextMenuLabel = parts.Label;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export const ContextMenuSubTrigger = parts.SubTrigger;
export const ContextMenuSubContent = parts.SubContent;
