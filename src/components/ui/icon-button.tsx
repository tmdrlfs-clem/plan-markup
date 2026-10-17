"use client";

import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";

import { cx } from "./cx";
import { toAriaKeyShortcuts } from "./shortcut";
import { Tooltip } from "./tooltip";

export type IconButtonSize = "sm" | "md";

const SIZE_CLASS: Record<IconButtonSize, string> = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
};

const ICON_PX: Record<IconButtonSize, number> = { sm: 16, md: 18 };

/** Shared look of IconButton, ToggleButton and toggle-group items. */
export function iconButtonClasses(size: IconButtonSize, extra?: string): string {
  return cx(
    "inline-flex shrink-0 items-center justify-center rounded border border-transparent bg-transparent text-text",
    "select-none focus-ring transition-colors",
    "not-aria-disabled:hover:border-border not-aria-disabled:hover:bg-surface-3",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    SIZE_CLASS[size],
    extra,
  );
}

export function iconSize(size: IconButtonSize): number {
  return ICON_PX[size];
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** Accessible name and tooltip text. Use a verb phrase ("Undo"). */
  label: string;
  icon: LucideIcon;
  /** Shortcut in table form; shown in the tooltip and set as aria-keyshortcuts. */
  shortcut?: string;
  /** Shown instead of the label in the tooltip while disabled (UX-DR32). */
  disabledReason?: string;
  size?: IconButtonSize;
}

/**
 * Ghost icon button. While `disabled` it stays focusable (aria-disabled) so the
 * tooltip can explain why; clicks are swallowed.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon: Icon,
    shortcut,
    disabledReason,
    size = "sm",
    disabled,
    type = "button",
    className,
    onClick,
    ...props
  },
  ref,
) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <Tooltip content={disabled && disabledReason ? disabledReason : label} shortcut={disabled ? undefined : shortcut}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-keyshortcuts={shortcut ? toAriaKeyShortcuts(shortcut) : undefined}
        aria-disabled={disabled ? true : undefined}
        className={iconButtonClasses(size, className)}
        onClick={handleClick}
        {...props}
      >
        <Icon size={iconSize(size)} aria-hidden="true" />
      </button>
    </Tooltip>
  );
});
