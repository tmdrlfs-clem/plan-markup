"use client";

import type { ReactElement, ReactNode } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cx } from "./cx";
import { keepOpenOnLocalEscape } from "./dialog-shared";

export interface PopoverProps {
  /** Single focusable element that opens the popover (Enter / Space). */
  trigger: ReactElement;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** Accessible name for the popover content. */
  "aria-label"?: string;
}

/** Esc closes and focus returns to the trigger. */
export function Popover({
  trigger,
  children,
  side = "bottom",
  align = "start",
  open,
  onOpenChange,
  className,
  "aria-label": ariaLabel,
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          aria-label={ariaLabel}
          onEscapeKeyDown={keepOpenOnLocalEscape}
          className={cx(
            "z-popover rounded-md border border-strong bg-surface-2 p-3 text-ws-md text-text shadow-2",
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
