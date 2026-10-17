"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Toolbar as ToolbarPrimitive } from "radix-ui";

import { cx } from "./cx";
import { IconButton, type IconButtonProps } from "./icon-button";
import { renderToggleItem, type ToggleItemProps } from "./toggle-group";

export type ToolbarProps = Omit<ComponentPropsWithoutRef<typeof ToolbarPrimitive.Root>, "aria-label"> & {
  /** Required: names the toolbar landmark. */
  "aria-label": string;
};

/** Arrow keys move between items; Tab leaves the toolbar. */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { className, orientation = "horizontal", ...props },
  ref,
) {
  return (
    <ToolbarPrimitive.Root
      ref={ref}
      orientation={orientation}
      className={cx(
        "z-toolbar flex items-center gap-1 bg-surface-2 px-2",
        orientation === "horizontal" ? "h-9 flex-row" : "w-11 flex-col py-2",
        className,
      )}
      {...props}
    />
  );
});

export const ToolbarButton = forwardRef<HTMLButtonElement, IconButtonProps>(function ToolbarButton(
  props,
  ref,
) {
  return (
    <ToolbarPrimitive.Button asChild>
      <IconButton ref={ref} {...props} />
    </ToolbarPrimitive.Button>
  );
});

export type ToolbarToggleGroupProps = ComponentPropsWithoutRef<typeof ToolbarPrimitive.ToggleGroup> & {
  "aria-label": string;
};

export const ToolbarToggleGroup = forwardRef<HTMLDivElement, ToolbarToggleGroupProps>(
  function ToolbarToggleGroup({ className, ...props }, ref) {
    return (
      <ToolbarPrimitive.ToggleGroup
        ref={ref}
        className={cx("inline-flex items-center gap-0.5", className)}
        {...(props as ComponentPropsWithoutRef<typeof ToolbarPrimitive.ToggleGroup>)}
      />
    );
  },
);

export const ToolbarToggleItem = forwardRef<HTMLButtonElement, ToggleItemProps>(
  function ToolbarToggleItem(props, ref) {
    return renderToggleItem(ToolbarPrimitive.ToggleItem, props, ref);
  },
);

export function ToolbarSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToolbarPrimitive.Separator>) {
  return (
    <ToolbarPrimitive.Separator
      className={cx(
        "mx-1 self-stretch bg-border data-[orientation=horizontal]:h-px data-[orientation=vertical]:w-px",
        className,
      )}
      {...props}
    />
  );
}
