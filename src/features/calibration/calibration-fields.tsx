"use client";

// Parts shared by the Calibrate and Verify dialogs (Stories 4.3, 4.4): a
// labelled text field with tabular figures, and the instruction bar shown
// while two points are picked. Story 1.7 parts only.

import { useEffect, useId, useRef, type InputHTMLAttributes } from "react";

import { Button } from "@/components/ui/button";
import { FieldShell, fieldControlClasses } from "@/components/ui/field";

/** A workspace text field (Story 1.7 FieldShell + control classes) with tabular figures. */
export function TextInput({
  label,
  error,
  focusOnMount = false,
  ...props
}: { label: string; error?: string; focusOnMount?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  // After the dialog's own first-field focus (the method tabs come first in the body).
  useEffect(() => {
    if (!focusOnMount) return;
    const frame = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusOnMount]);
  return (
    <FieldShell layout="workspace" label={label} htmlFor={id} error={error} errorId={`${id}-error`}>
      <input
        ref={ref}
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${fieldControlClasses("workspace", Boolean(error))} num`}
        {...props}
      />
    </FieldShell>
  );
}

/** The collapsed dialog while picking (AC 2): announced politely; Esc or Cancel brings the dialog back. */
export function PickBar({ step, onCancel }: { step: 1 | 2; onCancel: () => void }) {
  return (
    <div
      data-testid="calibrate-pick-bar"
      className="fixed left-1/2 top-24 z-popover flex -translate-x-1/2 items-center gap-3 rounded-sm border border-strong bg-surface-1 py-1 pl-3 pr-1 text-ws-md text-text shadow-2"
    >
      <span role="status" aria-live="polite">
        {step === 1 ? "Click the first point · Esc to cancel" : "Click the second point · Esc to cancel"}
      </span>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
