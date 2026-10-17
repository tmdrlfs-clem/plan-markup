"use client";

import { createContext, useContext, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { formatShortcut } from "./shortcut";

const HasProviderContext = createContext(false);

/** Mount once near the root so tooltips share the open delay. Tooltip works without it too. */
export function TooltipProvider(props: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <HasProviderContext.Provider value>
      <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={300} {...props} />
    </HasProviderContext.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  /** Shortcut in table form, e.g. "Ctrl+Shift+M"; shown in a muted kbd. */
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  /** Single element that receives the hover/focus handlers. */
  children: ReactElement;
}

export function Tooltip({ content, shortcut, side = "bottom", children }: TooltipProps) {
  const hasProvider = useContext(HasProviderContext);
  const tooltip = (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-tooltip flex max-w-[280px] items-center gap-2 rounded-sm border border-strong bg-surface-3 px-2 py-1 text-ws-sm text-text shadow-1"
        >
          <span>{content}</span>
          {shortcut ? (
            <kbd className="num font-sans text-ws-xs text-muted">{formatShortcut(shortcut)}</kbd>
          ) : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
  return hasProvider ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
}
