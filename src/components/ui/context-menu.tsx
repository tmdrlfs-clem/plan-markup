"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type KeyboardEvent } from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";

import { cx } from "./cx";
import { createMenuParts, type MenuPrimitive } from "./menu-parts";

const parts = createMenuParts(ContextMenuPrimitive as unknown as MenuPrimitive);

export const ContextMenu = ContextMenuPrimitive.Root;

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
    event.currentTarget.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
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
