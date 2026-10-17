"use client";

import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementType,
  type MouseEvent,
  type Ref,
} from "react";
import type { LucideIcon } from "lucide-react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { cx } from "./cx";
import { iconSize, type IconButtonSize } from "./icon-button";
import { toAriaKeyShortcuts } from "./shortcut";
import { toggleClasses } from "./toggle-button";
import { Tooltip } from "./tooltip";

export type ToggleGroupProps = ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & {
  /** Required: a group needs a name for assistive technology. */
  "aria-label": string;
};

/** Radix ToggleGroup (single or multiple) with roving focus. */
export const ToggleGroup = forwardRef<HTMLDivElement, ToggleGroupProps>(function ToggleGroup(
  { className, ...props },
  ref,
) {
  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      className={cx("inline-flex items-center gap-0.5", className)}
      {...(props as ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>)}
    />
  );
});

export interface ToggleItemProps
  extends Omit<ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>, "children" | "aria-label"> {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  disabledReason?: string;
  size?: IconButtonSize;
}

/** Item body shared by ToggleGroupItem and the toolbar's toggle items. */
export function renderToggleItem(
  Item: ElementType,
  {
    label,
    icon: Icon,
    shortcut,
    disabledReason,
    size = "sm",
    disabled,
    className,
    onClick,
    ...props
  }: ToggleItemProps,
  ref: Ref<HTMLButtonElement>,
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
      <Item
        ref={ref}
        aria-label={label}
        aria-keyshortcuts={shortcut ? toAriaKeyShortcuts(shortcut) : undefined}
        aria-disabled={disabled ? true : undefined}
        className={toggleClasses(size, className)}
        onClick={handleClick}
        {...props}
      >
        <Icon size={iconSize(size)} aria-hidden="true" />
      </Item>
    </Tooltip>
  );
}

export const ToggleGroupItem = forwardRef<HTMLButtonElement, ToggleItemProps>(function ToggleGroupItem(
  props,
  ref,
) {
  return renderToggleItem(ToggleGroupPrimitive.Item, props, ref);
});
