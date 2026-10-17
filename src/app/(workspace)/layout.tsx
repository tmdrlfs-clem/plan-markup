import { requireActiveUser } from "@/lib/auth";

// Defence in depth only: layouts do not re-run on client navigation, so every
// workspace page calls requireActiveUser() itself.
export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  await requireActiveUser();
  return children;
}
