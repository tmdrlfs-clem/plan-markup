"use client";

import { ChevronDown, LogOut } from "lucide-react";

import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cx } from "@/components/ui/cx";
import { MENU_TOP_TRIGGER } from "@/components/ui/menu-styles";

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
}

export function displayName(user: WorkspaceUser): string {
  return user.name.trim() === "" ? user.email : user.name;
}

/** Account menu at the right end of the menu bar: who is signed in, and Sign out. */
export function AccountMenu({ user, onSignOut }: { user: WorkspaceUser; onSignOut: () => void }) {
  const name = displayName(user);
  return (
    <Menu>
      <MenuTrigger asChild>
        {/* Same look as the menu bar triggers next to it. */}
        <button type="button" aria-label={`Account: ${name}`} className={cx(MENU_TOP_TRIGGER, "gap-1")}>
          <span className="max-w-[200px] truncate">{name}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>{user.email}</MenuLabel>
        <MenuSeparator />
        <MenuItem icon={LogOut} onSelect={onSignOut}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
