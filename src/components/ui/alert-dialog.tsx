"use client";

import { useRef, type ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { Button } from "./button";
import { cx } from "./cx";
import { DialogFooter, DialogPrimary, PrimaryRefContext, handleEnterAsPrimary, keepOpenOnLocalEscape } from "./dialog-shared";

export interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  /** The scope sentence, e.g. "Delete 3 pages from L17 RCP?". Required. */
  description: string;
  cancelLabel?: string;
  /** A verb that names the action ("Delete 3 pages"), never "OK". */
  actionLabel: string;
  onAction: () => void;
  /** Danger-filled action button. */
  destructive?: boolean;
}

/**
 * Confirmation dialog. Initial focus is on Cancel, overlay click does not close it,
 * Esc cancels, and Enter on a non-button element triggers the action.
 */
export function AlertDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  cancelLabel = "Cancel",
  actionLabel,
  onAction,
  destructive = false,
}: AlertDialogProps) {
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger> : null}
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-dialog bg-black/50" />
        <AlertDialogPrimitive.Content
          onEscapeKeyDown={keepOpenOnLocalEscape}
          onKeyDown={(event) => handleEnterAsPrimary(event, primaryRef.current)}
          className={cx(
            "fixed left-1/2 top-1/2 z-dialog w-[calc(100vw-32px)] max-w-[400px] -translate-x-1/2 -translate-y-1/2",
            "flex flex-col rounded-lg border border-strong bg-surface-1 text-text shadow-3",
          )}
        >
          <PrimaryRefContext.Provider value={primaryRef}>
            <div className="px-5 pb-4 pt-4">
              <AlertDialogPrimitive.Title className="text-ws-xl font-semibold">{title}</AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className="mt-2 text-ws-md text-text">
                {description}
              </AlertDialogPrimitive.Description>
            </div>
            <DialogFooter
              secondary={
                <AlertDialogPrimitive.Cancel asChild>
                  <Button variant="secondary">{cancelLabel}</Button>
                </AlertDialogPrimitive.Cancel>
              }
              primary={
                <AlertDialogPrimitive.Action asChild>
                  <DialogPrimary variant={destructive ? "danger" : "primary"} onClick={onAction}>
                    {actionLabel}
                  </DialogPrimary>
                </AlertDialogPrimitive.Action>
              }
            />
          </PrimaryRefContext.Provider>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
