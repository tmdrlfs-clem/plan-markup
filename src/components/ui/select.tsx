"use client";

import { useId } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";

import { cx } from "./cx";
import { FieldShell, fieldControlClasses, type FieldLayout } from "./field";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** workspace = label left, 28 px; admin = label above, 40 px (UX-DR34). */
  layout?: FieldLayout;
  error?: string;
  disabled?: boolean;
  id?: string;
}

/** Radix Select: Enter / Space / arrows open it, arrows move, Enter selects, typing jumps. */
export function Select({
  label,
  value,
  onValueChange,
  options,
  placeholder,
  layout = "workspace",
  error,
  disabled,
  id,
}: SelectProps) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const errorId = `${triggerId}-error`;

  return (
    <FieldShell
      layout={layout}
      label={label}
      htmlFor={triggerId}
      error={error}
      errorId={errorId}
    >
      <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectPrimitive.Trigger
          id={triggerId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cx(fieldControlClasses(layout, Boolean(error)), "flex items-center justify-between gap-2 text-left")}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon asChild>
            <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-muted" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className="z-popover min-w-[var(--radix-select-trigger-width)] rounded-md border border-strong bg-surface-2 p-1 text-text shadow-2"
          >
            <SelectPrimitive.Viewport>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="relative flex h-7 cursor-default select-none items-center gap-2 rounded-sm pl-7 pr-2 text-ws-md outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:shadow-[inset_2px_0_0_0_var(--accent)] data-[disabled]:pointer-events-none data-[disabled]:text-muted data-[disabled]:opacity-60"
                >
                  <span className="absolute left-2 flex size-4 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <Check size={16} aria-hidden="true" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </FieldShell>
  );
}
