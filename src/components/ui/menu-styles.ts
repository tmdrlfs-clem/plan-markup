// One style module for Menu, MenuBar and ContextMenu so all three look identical.

export const MENU_CONTENT =
  "z-popover min-w-[200px] rounded-md border border-strong bg-surface-2 p-1 text-text shadow-2";

/** Row 28 px, highlighted = surface-3 plus an accent bar on the left. */
export const MENU_ITEM =
  "relative flex h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 text-ws-md text-text outline-none " +
  "data-[highlighted]:bg-surface-3 data-[highlighted]:shadow-[inset_2px_0_0_0_var(--accent)] " +
  "data-[disabled]:pointer-events-none data-[disabled]:text-muted data-[disabled]:opacity-60";

export const MENU_ITEM_DESTRUCTIVE = "text-danger";

export const MENU_SEPARATOR = "-mx-1 my-1 h-px bg-border";

export const MENU_LABEL = "px-2 py-1 text-ws-xs font-semibold text-muted";

export const MENU_SHORTCUT = "num ml-auto pl-4 text-ws-sm text-muted";

/** Fixed 16 px slot for the icon / check indicator at the start of a row. */
export const MENU_ICON_SLOT = "flex size-4 shrink-0 items-center justify-center";

export const MENU_TOP_TRIGGER =
  "inline-flex h-7 select-none items-center rounded-sm px-3 text-ws-md text-text outline-none focus-ring " +
  "data-[highlighted]:bg-surface-3 data-[state=open]:bg-surface-3";
