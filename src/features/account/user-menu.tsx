import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/lib/auth";
import { signOut } from "./actions";

/**
 * Minimal user menu: name (or email) and Sign out. Story 1.7 brings the Menu
 * components and Story 1.8 moves Sign out into the File and account menus.
 */
export function UserMenu({ user }: { user: AuthUser }) {
  const label = user.name.trim() === "" ? user.email : user.name;
  return (
    <div className="flex items-center gap-3">
      <span className="text-ws-lg text-muted" data-testid="user-menu-name">
        {label}
      </span>
      <form action={signOut}>
        <Button type="submit" variant="secondary" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  );
}
