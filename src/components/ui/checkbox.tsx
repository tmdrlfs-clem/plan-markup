"use client";

import { forwardRef, useId, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cx } from "./cx";

export interface CheckboxProps
  extends Omit<ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, "children"> {
  label: string;
}

/** Checked = accent fill plus a check glyph; "indeterminate" shows a minus (aria-checked="mixed"). */
export const Checkbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  function Checkbox({ label, id, className, ...props }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <div className={cx("flex items-center gap-2", className)}>
        <CheckboxPrimitive.Root
          ref={ref}
          id={inputId}
          className={cx(
            "group flex size-4 shrink-0 items-center justify-center rounded-sm border border-strong bg-surface-2 text-accent-fg focus-ring",
            "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
            "data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          {...props}
        >
          <CheckboxPrimitive.Indicator>
            <Check size={12} strokeWidth={3} aria-hidden="true" className="group-data-[state=indeterminate]:hidden" />
            <Minus size={12} strokeWidth={3} aria-hidden="true" className="hidden group-data-[state=indeterminate]:block" />
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
        <label htmlFor={inputId} className="select-none text-ws-md text-text">
          {label}
        </label>
      </div>
    );
  },
);
