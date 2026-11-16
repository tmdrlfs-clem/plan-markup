"use client";

import { ChevronDown, LogOut, ShieldCheck, Users } from "lucide-react";

import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cx } from "@/components/ui/cx";
import { MENU_TOP_TRIGGER } from "@/components/ui/menu-styles";
import { planSentence, type EffectivePlan } from "@/lib/plans";

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  /** Story 10.4: shows the Admin item. Display only: the admin area checks for itself. */
  isPlatformAdmin?: boolean;
  /** Story 10.6: shows the Company item. Display only: the Company area checks for itself. */
  isCompanyAdmin?: boolean;
  /** The plan the user works under: their company's, or their own. Shown, never set, here. */
  plan?: EffectivePlan;
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
        {user.plan ? <MenuLabel data-testid="account-plan">{planSentence(user.plan)}</MenuLabel> : null}
        <MenuSeparator />
        {user.isCompanyAdmin ? (
          <MenuItem
            icon={Users}
            // A full page load on purpose, as for the admin area below.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            onSelect={() => window.location.assign("/company/members")}
          >
            Company: members
          </MenuItem>
        ) : null}
        {user.isPlatformAdmin ? (
          <MenuItem
            icon={ShieldCheck}
            // A full page load on purpose: it leaves the workspace (open files, the worker, the theme on <html>) behind.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            onSelect={() => window.location.assign("/admin/users")}
          >
            Admin: accounts
          </MenuItem>
        ) : null}
        <MenuItem icon={LogOut} onSelect={onSignOut}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
