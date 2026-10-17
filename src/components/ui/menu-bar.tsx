"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Menubar as MenubarPrimitive } from "radix-ui";

import { cx } from "./cx";
import { createMenuParts, type MenuPrimitive } from "./menu-parts";
import { MENU_TOP_TRIGGER } from "./menu-styles";

const parts = createMenuParts(MenubarPrimitive as unknown as MenuPrimitive);

type MenuBarProps = Omit<ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>, "aria-label"> & {
  /** Required: names the menubar landmark. */
  "aria-label": string;
};

/** Left / Right move between top-level menus; while one is open, moving opens the neighbour. */
export const MenuBar = forwardRef<ElementRef<typeof MenubarPrimitive.Root>, MenuBarProps>(
  function MenuBar({ className, ...props }, ref) {
    return (
      <MenubarPrimitive.Root
        ref={ref}
        className={cx("flex h-9 items-center gap-0.5 bg-surface-2 px-2", className)}
        {...props}
      />
    );
  },
);

export const MenuBarMenu = MenubarPrimitive.Menu;

export const MenuBarTrigger = forwardRef<
  ElementRef<typeof MenubarPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>
>(function MenuBarTrigger({ className, ...props }, ref) {
  return <MenubarPrimitive.Trigger ref={ref} className={cx(MENU_TOP_TRIGGER, className)} {...props} />;
});

export const MenuBarContent = parts.Content;
export const MenuBarItem = parts.Item;
export const MenuBarCheckboxItem = parts.CheckboxItem;
export const MenuBarRadioGroup = parts.RadioGroup;
export const MenuBarRadioItem = parts.RadioItem;
export const MenuBarSeparator = parts.Separator;
export const MenuBarLabel = parts.Label;
export const MenuBarSub = MenubarPrimitive.Sub;
export const MenuBarSubTrigger = parts.SubTrigger;
export const MenuBarSubContent = parts.SubContent;
