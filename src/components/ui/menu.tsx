"use client";

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { createMenuParts } from "./menu-parts";

const parts = createMenuParts(DropdownMenuPrimitive);

/** Dropdown menu. Enter / Space / ArrowDown on the trigger opens it; Esc closes and refocuses the trigger. */
export const Menu = DropdownMenuPrimitive.Root;
export const MenuTrigger = DropdownMenuPrimitive.Trigger;
export const MenuContent = parts.Content;
/** `shortcut` is display + aria-keyshortcuts only; the command registry binds the keys. */
export const MenuItem = parts.Item;
export const MenuCheckboxItem = parts.CheckboxItem;
export const MenuRadioGroup = parts.RadioGroup;
export const MenuRadioItem = parts.RadioItem;
export const MenuSeparator = parts.Separator;
export const MenuLabel = parts.Label;
export const MenuSub = DropdownMenuPrimitive.Sub;
export const MenuSubTrigger = parts.SubTrigger;
export const MenuSubContent = parts.SubContent;
