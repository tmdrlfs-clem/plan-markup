"use client";

import { forwardRef, useId, useState, type InputHTMLAttributes } from "react";
import { CircleX, Eye, EyeOff } from "lucide-react";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  type?: "text" | "email" | "password";
  hint?: string;
  /** Inline error message; also sets aria-invalid. */
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    { label, type = "text", hint, error, id, className, ...props },
    ref,
  ) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;
    const [revealed, setRevealed] = useState(false);

    const describedBy =
      [hint ? hintId : null, error ? errorId : null]
        .filter(Boolean)
        .join(" ") || undefined;
    const isPassword = type === "password";
    const inputType = isPassword && revealed ? "text" : type;

    const inputClasses = [
      "h-10 w-full rounded border bg-surface-2 px-3 text-ad-sm text-text",
      "placeholder:text-muted focus-ring disabled:opacity-50",
      error ? "border-danger" : "border-strong",
      isPassword ? "pr-10" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-ad-sm font-medium text-text">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-ws-lg text-muted">
            {hint}
          </p>
        ) : null}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={inputType}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={inputClasses}
            {...props}
          />
          {isPassword ? (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? "Hide password" : "Show password"}
              aria-pressed={revealed}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded text-muted hover:text-text focus-ring"
            >
              {revealed ? (
                <EyeOff size={16} aria-hidden="true" />
              ) : (
                <Eye size={16} aria-hidden="true" />
              )}
            </button>
          ) : null}
        </div>
        {error ? (
          <p
            id={errorId}
            className="flex items-start gap-1 text-ws-lg text-danger"
          >
            <CircleX size={16} aria-hidden="true" className="mt-px shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    );
  },
);
