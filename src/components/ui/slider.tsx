"use client";

import { useId } from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { NumberField } from "./number-field";

export interface SliderFieldProps {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Unit text after the number and the limits, e.g. "m" or "%". */
  suffix?: string;
  disabled?: boolean;
}

/**
 * Slider paired with a NumberField that share one value and one label. The thumb is
 * labelled by the visible label; the limits read "min — max suffix" under the track.
 * Thumb keys come from Radix (arrows, PageUp / PageDown, Home / End).
 */
export function SliderField({
  label,
  value,
  onValueChange,
  min,
  max,
  step = 1,
  suffix,
  disabled,
}: SliderFieldProps) {
  const labelId = useId();
  const limits = `${min} — ${max}${suffix ? ` ${suffix}` : ""}`;

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-ws-sm text-muted">
        {label}
      </span>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 pt-2">
          <SliderPrimitive.Root
            value={[value]}
            onValueChange={([next]) => onValueChange(next)}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            className="relative flex h-4 w-full touch-none select-none items-center"
          >
            <SliderPrimitive.Track className="relative h-1 grow rounded-sm bg-surface-3">
              <SliderPrimitive.Range className="absolute h-full rounded-sm bg-accent" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb
              aria-labelledby={labelId}
              className="block size-3.5 rounded-sm border border-strong bg-surface-1 focus-ring"
            />
          </SliderPrimitive.Root>
          <p className="num mt-1 text-center text-ws-xs text-muted">{limits}</p>
        </div>
        <div className="w-24 shrink-0">
          <NumberField
            kind="number"
            label={label}
            hideLabel
            value={value}
            onValueChange={onValueChange}
            min={min}
            max={max}
            step={step}
            suffix={suffix}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
