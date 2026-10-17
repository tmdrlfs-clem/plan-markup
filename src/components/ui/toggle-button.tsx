"use client";

import { forwardRef, type ComponentPropsWithoutRef, type MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { Toggle as TogglePrimitive } from "radix-ui";

import { cx } from "./cx";
import { iconButtonClasses, iconSize, type IconButtonSize } from "./icon-button";
import { toAriaKeyShortcuts } from "./shortcut";
import { Tooltip } from "./tooltip";

/**
 * Pressed = accent fill plus an inset bottom bar, so the state is not colour-only.
 * Styled from aria-pressed (toggle, multiple group) and aria-checked (single group):
 * the tooltip trigger overwrites data-state on the same element.
 */
export function toggleClasses(size: IconButtonSize, extra?: string): string {
  return iconButtonClasses(
    size,
    cx(
      "aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-fg",
      "aria-pressed:shadow-[inset_0_-2px_0_0_var(--accent-fg)]",
      "aria-checked:border-accent aria-checked:bg-accent aria-checked:text-accent-fg",
      "aria-checked:shadow-[inset_0_-2px_0_0_var(--accent-fg)]",
      // Keep the accent fill under hover; the shared hover style would turn the text unreadable.
      "aria-pressed:not-aria-disabled:hover:border-accent aria-pressed:not-aria-disabled:hover:bg-accent",
      "aria-checked:not-aria-disabled:hover:border-accent aria-checked:not-aria-disabled:hover:bg-accent",
      extra,
    ),
  );
}

export interface ToggleButtonProps
  extends Omit<ComponentPropsWithoutRef<typeof TogglePrimitive.Root>, "children" | "aria-label"> {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  disabledReason?: string;
  size?: IconButtonSize;
}

export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(function ToggleButton(
  { label, icon: Icon, shortcut, disabledReason, size = "sm", disabled, className, onClick, ...props },
  ref,
) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // preventDefault stops Radix from toggling while the button is aria-disabled.
    if (disabled) event.preventDefault();
    onClick?.(event);
  }

  return (
    <Tooltip content={disabled && disabledReason ? disabledReason : label} shortcut={disabled ? undefined : shortcut}>
      <TogglePrimitive.Root
        ref={ref}
        aria-label={label}
        aria-keyshortcuts={shortcut ? toAriaKeyShortcuts(shortcut) : undefined}
        aria-disabled={disabled ? true : undefined}
        className={toggleClasses(size, className)}
        onClick={handleClick}
        {...props}
      >
        <Icon size={iconSize(size)} aria-hidden="true" />
      </TogglePrimitive.Root>
    </Tooltip>
  );
});
