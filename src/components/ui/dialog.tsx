"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cx } from "./cx";
import { PrimaryRefContext, handleEnterAsPrimary, keepOpenOnLocalEscape } from "./dialog-shared";
import { IconButton } from "./icon-button";

export { DialogFooter, DialogPrimary } from "./dialog-shared";

const MAX_WIDTH = { sm: "max-w-[400px]", md: "max-w-[560px]", lg: "max-w-[720px]" } as const;

// First field to focus. Skips disabled and hidden inputs (Radix renders aria-hidden native
// inputs for Checkbox / Select inside forms) and includes button-based fields.
const FOCUSABLE = [
  "input:not([type='hidden']):not([disabled]):not([aria-hidden='true']):not([tabindex='-1'])",
  "select:not([disabled]):not([aria-hidden='true']):not([tabindex='-1'])",
  "textarea:not([disabled])",
  "button[role='combobox']:not([disabled])",
  "button[role='checkbox']:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog; focus returns to it on close. */
  trigger?: ReactNode;
  title: string;
  description?: string;
  /** Body. Put a `DialogPrimary` in the footer so Enter can activate it. */
  children?: ReactNode;
  /** Normally `<DialogFooter secondary={...} primary={<DialogPrimary>Save</DialogPrimary>} />`. */
  footer: ReactNode;
  size?: keyof typeof MAX_WIDTH;
  /** Focus target on close when the dialog is controlled and has no `trigger`. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Modal dialog. Esc cancels, Enter triggers the primary action (not from a textarea,
 * button or `data-enter-ignore` element), focus is trapped and returns to the trigger.
 * Button labels are verbs ("Save", "Cancel"), never "OK".
 */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  size = "md",
  returnFocusRef,
}: DialogProps) {
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-dialog bg-black/50" />
        <DialogPrimitive.Content
          // Without a description, opt out of Radix aria-describedby (and its dev warning).
          {...(description ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={(event) => {
            // First field in the body, else the primary button.
            event.preventDefault();
            const field = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE);
            (field ?? primaryRef.current)?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocusRef?.current) {
              event.preventDefault();
              returnFocusRef.current.focus();
            }
          }}
          onEscapeKeyDown={keepOpenOnLocalEscape}
          onKeyDown={(event) => handleEnterAsPrimary(event, primaryRef.current)}
          className={cx(
            "fixed left-1/2 top-1/2 z-dialog w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2",
            "flex max-h-[calc(100vh-32px)] flex-col rounded-lg border border-strong bg-surface-1 text-text shadow-3",
            MAX_WIDTH[size],
          )}
        >
          <PrimaryRefContext.Provider value={primaryRef}>
            <div className="flex items-start gap-3 px-5 pt-4 pr-12">
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="text-ws-xl font-semibold">{title}</DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="mt-1 text-ws-md text-muted">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
            </div>
            <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-ws-md">
              {children}
            </div>
            {footer}
            {/* Last in DOM order so Tab reaches fields and actions first; placed top-right. */}
            <DialogPrimitive.Close asChild>
              <IconButton label="Close" icon={X} className="absolute right-3 top-3" />
            </DialogPrimitive.Close>
          </PrimaryRefContext.Provider>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
