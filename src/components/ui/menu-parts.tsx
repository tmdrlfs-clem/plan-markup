"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import { Check, ChevronRight, Circle, type LucideIcon } from "lucide-react";
import type { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { cx } from "./cx";
import {
  MENU_CONTENT,
  MENU_ICON_SLOT,
  MENU_ITEM,
  MENU_ITEM_DESTRUCTIVE,
  MENU_LABEL,
  MENU_SEPARATOR,
  MENU_SHORTCUT,
} from "./menu-styles";
import { formatShortcut, toAriaKeyShortcuts } from "./shortcut";

/**
 * DropdownMenu, Menubar and ContextMenu expose the same part names; this is the
 * structural shape the shared factory needs from any of them.
 */
export type MenuPrimitive = Pick<
  typeof DropdownMenuPrimitive,
  | "Portal"
  | "Content"
  | "Item"
  | "CheckboxItem"
  | "RadioGroup"
  | "RadioItem"
  | "ItemIndicator"
  | "Separator"
  | "Label"
  | "SubTrigger"
  | "SubContent"
>;

export interface MenuItemExtras {
  /** Shortcut in table form; displayed right-aligned and set as aria-keyshortcuts. */
  shortcut?: string;
  icon?: LucideIcon;
  destructive?: boolean;
}

function Shortcut({ shortcut }: { shortcut?: string }): ReactNode {
  return shortcut ? (
    <span aria-hidden="true" className={MENU_SHORTCUT}>
      {formatShortcut(shortcut)}
    </span>
  ) : null;
}

function IconSlot({ icon: Icon }: { icon?: LucideIcon }): ReactNode {
  return (
    <span className={MENU_ICON_SLOT}>{Icon ? <Icon size={16} aria-hidden="true" /> : null}</span>
  );
}

export function createMenuParts(P: MenuPrimitive) {
  type ItemProps = ComponentPropsWithoutRef<typeof P.Item> & MenuItemExtras;

  const Content = forwardRef<ElementRef<typeof P.Content>, ComponentPropsWithoutRef<typeof P.Content>>(
    function MenuContent({ className, sideOffset = 4, ...props }, ref) {
      return (
        <P.Portal>
          <P.Content ref={ref} sideOffset={sideOffset} className={cx(MENU_CONTENT, className)} {...props} />
        </P.Portal>
      );
    },
  );

  const Item = forwardRef<ElementRef<typeof P.Item>, ItemProps>(function MenuItem(
    { shortcut, icon, destructive, className, children, ...props },
    ref,
  ) {
    return (
      <P.Item
        ref={ref}
        aria-keyshortcuts={shortcut ? toAriaKeyShortcuts(shortcut) : undefined}
        className={cx(MENU_ITEM, destructive && MENU_ITEM_DESTRUCTIVE, className)}
        {...props}
      >
        <IconSlot icon={icon} />
        <span>{children}</span>
        <Shortcut shortcut={shortcut} />
      </P.Item>
    );
  });

  const CheckboxItem = forwardRef<
    ElementRef<typeof P.CheckboxItem>,
    ComponentPropsWithoutRef<typeof P.CheckboxItem> & Pick<MenuItemExtras, "shortcut">
  >(function MenuCheckboxItem({ shortcut, className, children, ...props }, ref) {
    return (
      <P.CheckboxItem
        ref={ref}
        aria-keyshortcuts={shortcut ? toAriaKeyShortcuts(shortcut) : undefined}
        className={cx(MENU_ITEM, className)}
        {...props}
      >
        <span className={MENU_ICON_SLOT}>
          <P.ItemIndicator>
            <Check size={16} aria-hidden="true" />
          </P.ItemIndicator>
        </span>
        <span>{children}</span>
        <Shortcut shortcut={shortcut} />
      </P.CheckboxItem>
    );
  });

  const RadioItem = forwardRef<
    ElementRef<typeof P.RadioItem>,
    ComponentPropsWithoutRef<typeof P.RadioItem> & Pick<MenuItemExtras, "shortcut">
  >(function MenuRadioItem({ shortcut, className, children, ...props }, ref) {
    return (
      <P.RadioItem
        ref={ref}
        aria-keyshortcuts={shortcut ? toAriaKeyShortcuts(shortcut) : undefined}
        className={cx(MENU_ITEM, className)}
        {...props}
      >
        <span className={MENU_ICON_SLOT}>
          <P.ItemIndicator>
            <Circle size={8} fill="currentColor" aria-hidden="true" />
          </P.ItemIndicator>
        </span>
        <span>{children}</span>
        <Shortcut shortcut={shortcut} />
      </P.RadioItem>
    );
  });

  const Separator = forwardRef<
    ElementRef<typeof P.Separator>,
    ComponentPropsWithoutRef<typeof P.Separator>
  >(function MenuSeparator({ className, ...props }, ref) {
    return <P.Separator ref={ref} className={cx(MENU_SEPARATOR, className)} {...props} />;
  });

  const Label = forwardRef<ElementRef<typeof P.Label>, ComponentPropsWithoutRef<typeof P.Label>>(
    function MenuLabel({ className, ...props }, ref) {
      return <P.Label ref={ref} className={cx(MENU_LABEL, className)} {...props} />;
    },
  );

  const SubTrigger = forwardRef<
    ElementRef<typeof P.SubTrigger>,
    ComponentPropsWithoutRef<typeof P.SubTrigger> & Pick<MenuItemExtras, "icon">
  >(function MenuSubTrigger({ icon, className, children, ...props }, ref) {
    return (
      <P.SubTrigger
        ref={ref}
        className={cx(MENU_ITEM, "data-[state=open]:bg-surface-3", className)}
        {...props}
      >
        <IconSlot icon={icon} />
        <span>{children}</span>
        <ChevronRight size={16} aria-hidden="true" className="ml-auto text-muted" />
      </P.SubTrigger>
    );
  });

  const SubContent = forwardRef<
    ElementRef<typeof P.SubContent>,
    ComponentPropsWithoutRef<typeof P.SubContent>
  >(function MenuSubContent({ className, ...props }, ref) {
    return (
      <P.Portal>
        <P.SubContent ref={ref} className={cx(MENU_CONTENT, className)} {...props} />
      </P.Portal>
    );
  });

  return { Content, Item, CheckboxItem, RadioItem, Separator, Label, SubTrigger, SubContent, RadioGroup: P.RadioGroup };
}
