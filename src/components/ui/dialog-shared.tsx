"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";

import { Button, type ButtonProps } from "./button";
import { cx } from "./cx";

/** Holds the dialog's primary button so Enter can trigger it (not DOM order). */
export type PrimaryRef = MutableRefObject<HTMLButtonElement | null>;

export const PrimaryRefContext = createContext<PrimaryRef | null>(null);

/** Primary action of a Dialog / AlertDialog. Enter inside the dialog activates it. */
export const DialogPrimary = forwardRef<HTMLButtonElement, ButtonProps>(function DialogPrimary(
  { variant = "primary", size = "md", ...props },
  ref,
) {
  const primaryRef = useContext(PrimaryRefContext);
  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      if (primaryRef) primaryRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [primaryRef, ref],
  );
  return <Button ref={setRef} variant={variant} size={size} {...props} />;
});

const ENTER_IGNORED =
  "textarea, button, a[href], select, [role='combobox'], [role='option'], [role='menuitem'], [data-enter-ignore]";

/**
 * Enter = primary (UX-DR32). Ignored while composing text, with modifiers, and when
 * focus is in a textarea, on a button (native Enter already activates it), in a
 * listbox / menu, or inside an element marked `data-enter-ignore`.
 */
export function handleEnterAsPrimary(event: KeyboardEvent<HTMLElement>, primary: HTMLButtonElement | null) {
  if (event.key !== "Enter" || event.defaultPrevented) return;
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.nativeEvent.isComposing) return;
  if ((event.target as HTMLElement).closest(ENTER_IGNORED)) return;
  if (!primary || isInactive(primary)) return;
  event.preventDefault();
  // Deferred so a field that commits on Enter (NumberField) re-renders its parent first;
  // the primary's onClick then sees the committed value, not the one from before the edit.
  setTimeout(() => {
    if (primary.isConnected && !isInactive(primary)) primary.click();
  }, 0);
}

function isInactive(button: HTMLButtonElement): boolean {
  return button.disabled || button.getAttribute("aria-disabled") === "true";
}

/** Set on a field whose Escape only reverts its own draft. */
export const ESCAPE_LOCAL_ATTR = "data-escape-local";

/**
 * `onEscapeKeyDown` for Dialog / AlertDialog / Popover: keep the layer open while the
 * focused field uses Escape to revert its draft (Radix listens on the document first).
 */
export function keepOpenOnLocalEscape(event: globalThis.KeyboardEvent) {
  if (event.target instanceof Element && event.target.closest(`[${ESCAPE_LOCAL_ATTR}]`)) {
    event.preventDefault();
  }
}

export interface DialogFooterProps {
  /** Left of the primary, usually Cancel. Labels are verbs. */
  secondary?: ReactNode;
  /** Rightmost: the primary action, normally a `DialogPrimary`. */
  primary: ReactNode;
  /** Far left, e.g. a "Back" button. */
  extra?: ReactNode;
  className?: string;
}

/** Secondary left, primary right (UX-DR32). */
export function DialogFooter({ secondary, primary, extra, className }: DialogFooterProps) {
  return (
    <div className={cx("flex items-center gap-2 border-t border-border px-5 py-3", className)}>
      {extra ? <div className="mr-auto flex items-center gap-2">{extra}</div> : null}
      <div className="ml-auto flex items-center justify-end gap-2">
        {secondary}
        {primary}
      </div>
    </div>
  );
}
