"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";

import { cx } from "./cx";

export interface CollapsibleProps {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Controls drawn at the end of the header, outside the toggle button. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Full-width header button; Enter / Space toggles. The chevron rotates unless motion is reduced. */
export function Collapsible({
  title,
  defaultOpen,
  open,
  onOpenChange,
  actions,
  children,
  className,
}: CollapsibleProps) {
  return (
    <CollapsiblePrimitive.Root
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
      className={cx("border-b border-border", className)}
    >
      <div className="flex h-8 items-center">
        <CollapsiblePrimitive.Trigger className="group flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-left text-ws-sm font-semibold text-text focus-ring hover:bg-surface-3">
          <ChevronRight
            size={16}
            aria-hidden="true"
            className="shrink-0 text-muted transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
          />
          <span className="truncate">{title}</span>
        </CollapsiblePrimitive.Trigger>
        {actions ? <div className="flex items-center gap-1 pr-2">{actions}</div> : null}
      </div>
      <CollapsiblePrimitive.Content className="px-3 pb-3 pt-1 text-ws-md">{children}</CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
