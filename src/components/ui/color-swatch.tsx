"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";

import { cx } from "./cx";

const SWATCH_BASE =
  "relative flex size-5 shrink-0 items-center justify-center rounded-sm border focus-ring " +
  "border-strong data-[selected=true]:border-2 data-[selected=true]:border-text";

/**
 * The check sits on a surface-coloured chip so it contrasts with any markup colour;
 * selection is shown by the check and a 2 px text-colour border, never colour alone.
 */
function SelectedGlyph() {
  return (
    <span
      aria-hidden="true"
      className="flex size-3.5 items-center justify-center rounded-sm bg-surface-1 text-text"
    >
      <Check size={10} strokeWidth={3} />
    </span>
  );
}

export interface ColorSwatchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color" | "onSelect" | "children"> {
  /** Markup colour: data, so it is applied inline (the one allowed inline style). */
  color: string;
  /** Colour name for assistive technology, e.g. "Red". */
  label: string;
  selected?: boolean;
  onSelect?: () => void;
}

/** 20 px colour button with `aria-pressed`. Use ColorSwatchGroup for a pick-one palette. */
export const ColorSwatch = forwardRef<HTMLButtonElement, ColorSwatchProps>(function ColorSwatch(
  { color, label, selected = false, onSelect, className, onClick, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={selected}
      data-selected={selected}
      className={cx(SWATCH_BASE, className)}
      style={{ backgroundColor: color }}
      onClick={(event) => {
        onClick?.(event);
        onSelect?.();
      }}
      {...props}
    >
      {selected ? <SelectedGlyph /> : null}
    </button>
  );
});

export interface ColorSwatchGroupProps {
  colors: Array<{ value: string; label: string }>;
  value?: string;
  onValueChange?: (value: string) => void;
  "aria-label": string;
  className?: string;
}

/** Radio group of swatches: one Tab stop, arrows move and select. */
export function ColorSwatchGroup({
  colors,
  value,
  onValueChange,
  "aria-label": ariaLabel,
  className,
}: ColorSwatchGroupProps) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={ariaLabel}
      value={value}
      onValueChange={onValueChange}
      orientation="horizontal"
      className={cx("flex flex-wrap items-center gap-1", className)}
    >
      {colors.map((color) => (
        <RadioGroupPrimitive.Item
          key={color.value}
          value={color.value}
          aria-label={color.label}
          data-selected={value === color.value}
          className={SWATCH_BASE}
          style={{ backgroundColor: color.value }}
        >
          {value === color.value ? <SelectedGlyph /> : null}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
