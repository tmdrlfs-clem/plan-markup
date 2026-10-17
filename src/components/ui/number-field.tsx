"use client";

import { forwardRef, useId, useState, type KeyboardEvent } from "react";

import {
  describeLength,
  formatLengthValue,
  lengthUnitSuffix,
  parseLength,
  type LengthUnit,
} from "@/core/geometry/length";
import { MM_PER_INCH } from "@/core/geometry/units";

import { cx } from "./cx";
import { FieldShell, fieldControlClasses, type FieldLayout } from "./field";

interface NumberFieldBaseProps {
  label: string;
  /** workspace = label left, 28 px; admin = label above, 40 px (UX-DR34). */
  layout?: FieldLayout;
  /** External error; shown instead of the field's own parse error. */
  error?: string;
  disabled?: boolean;
  id?: string;
  /** Keep the label for assistive technology but do not draw it (used by SliderField). */
  hideLabel?: boolean;
  /** In display units: mm, m, or inches for unit="ft-in" (plain numbers for kind="number"). */
  min?: number;
  max?: number;
  step?: number;
}

export interface LengthNumberFieldProps extends NumberFieldBaseProps {
  kind: "length";
  /** Value in millimetres. */
  value: number | null;
  onValueChange: (mm: number) => void;
  /** Display unit: the text is shown and the arrow keys step in this unit. */
  unit: LengthUnit;
}

export interface PlainNumberFieldProps extends NumberFieldBaseProps {
  kind?: "number";
  value: number | null;
  onValueChange: (value: number) => void;
  /** Shown after the text, e.g. "%" or "pt"; a trailing suffix is also accepted when typing. */
  suffix?: string;
}

export type NumberFieldProps = LengthNumberFieldProps | PlainNumberFieldProps;

const LENGTH_ERROR = `Enter a length like 4.6 m or 15'6"`;
const NEGATIVE_ERROR = "Enter a length of 0 or more";
const NUMBER_ERROR = "Enter a number";

function unitMm(unit: LengthUnit): number {
  return unit === "mm" ? 1 : unit === "m" ? 1000 : MM_PER_INCH;
}

function defaultStep(unit: LengthUnit | null): number {
  return unit === "m" ? 0.1 : 1;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function formatPlain(value: number): string {
  return String(round6(value));
}

const PLAIN_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Text field for measurements and numbers. Typing never reformats; Enter or leaving the field
 * commits (valid: normalised text + onValueChange, invalid: inline error and the last
 * valid value is kept). Arrow keys step, Shift and PageUp/PageDown step x10, Escape reverts.
 */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  props,
  ref,
) {
  const { label, layout = "workspace", error, disabled, id, hideLabel, min, max, value } = props;
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;

  const length = props.kind === "length";
  const unit: LengthUnit | null = props.kind === "length" ? props.unit : null;
  const suffixProp = props.kind === "length" ? undefined : props.suffix;
  const step = props.step ?? defaultStep(unit);
  const factor = unit ? unitMm(unit) : 1;

  const [draft, setDraft] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function formatValue(v: number): string {
    return unit ? formatLengthValue(v, unit) : formatPlain(v);
  }

  /** Parsed value in the stored unit (mm or plain), or an error message. */
  function parse(text: string): { ok: true; value: number } | { ok: false; message: string } {
    if (unit) {
      const result = parseLength(text, unit);
      if (result.ok) return { ok: true, value: result.mm };
      return { ok: false, message: result.reason === "negative" ? NEGATIVE_ERROR : LENGTH_ERROR };
    }
    let body = text.trim();
    if (suffixProp && body.toLowerCase().endsWith(suffixProp.toLowerCase())) {
      body = body.slice(0, body.length - suffixProp.length).trim();
    }
    if (!PLAIN_NUMBER.test(body)) return { ok: false, message: NUMBER_ERROR };
    return { ok: true, value: Number(body) };
  }

  /** Clamp in display units, then convert back to the stored unit. */
  function clamp(stored: number): number {
    let display = stored / factor;
    if (min !== undefined) display = Math.max(min, display);
    if (max !== undefined) display = Math.min(max, display);
    return round6(display * factor);
  }

  function apply(next: number) {
    if (next !== value) props.onValueChange(next);
  }

  function commit() {
    if (draft === null) return;
    const parsed = parse(draft);
    if (parsed.ok) {
      apply(clamp(parsed.value));
      setDraft(null);
      setParseError(null);
    } else {
      setParseError(parsed.message);
    }
  }

  function stepBy(direction: 1 | -1, multiplier: number) {
    let base = value;
    if (draft !== null) {
      const parsed = parse(draft);
      if (parsed.ok) base = parsed.value;
    }
    const baseDisplay = (base ?? (min !== undefined ? min * factor : 0)) / factor;
    const next = round6(baseDisplay + direction * step * multiplier);
    apply(clamp(next * factor));
    setDraft(null);
    setParseError(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled || event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowDown":
        event.preventDefault();
        stepBy(event.key === "ArrowUp" ? 1 : -1, event.shiftKey ? 10 : 1);
        break;
      case "PageUp":
      case "PageDown":
        event.preventDefault();
        stepBy(event.key === "PageUp" ? 1 : -1, 10);
        break;
      case "Enter":
        commit();
        break;
      case "Escape":
        if (draft !== null || parseError) {
          setDraft(null);
          setParseError(null);
        }
        break;
    }
  }

  const text = draft ?? (value === null ? "" : formatValue(value));
  const suffix = unit ? lengthUnitSuffix(unit) : (suffixProp ?? "");
  const shownError = error ?? parseError ?? undefined;
  const valueNow = value === null ? undefined : round6(value / factor);
  const valueText =
    value === null
      ? undefined
      : unit
        ? describeLength(value, unit)
        : `${formatPlain(value)}${suffixProp ? ` ${suffixProp}` : ""}`;

  return (
    <FieldShell
      layout={layout}
      label={label}
      htmlFor={inputId}
      labelHidden={hideLabel}
      error={shownError}
      errorId={errorId}
    >
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={text}
          aria-valuenow={valueNow}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={valueText}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? errorId : undefined}
          data-kind={length ? "length" : "number"}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className={cx(fieldControlClasses(layout, Boolean(shownError)), "num", suffix && "pr-9")}
        />
        {suffix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-ws-sm text-muted"
          >
            {suffix}
          </span>
        ) : null}
      </div>
    </FieldShell>
  );
});
