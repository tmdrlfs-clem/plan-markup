import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded border font-medium " +
  "select-none whitespace-nowrap transition-colors focus-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-accent bg-accent text-accent-fg enabled:hover:brightness-110",
  secondary:
    "border-strong bg-transparent text-text enabled:hover:bg-surface-3",
  ghost:
    "border-transparent bg-transparent text-text enabled:hover:border-border enabled:hover:bg-surface-3",
  destructive:
    "border-danger bg-transparent text-danger enabled:hover:bg-surface-3",
  // Danger-filled primary for confirmations of destructive actions (UX-DR32).
  danger:
    "border-danger bg-danger text-accent-fg enabled:hover:brightness-110",
};

// sm = 28 px (workspace), md = 40 px (admin and auth forms).
const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-ws-lg",
  md: "h-10 px-4 text-ad-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", type = "button", className, ...props },
  ref,
) {
  const classes = cx(BASE, VARIANTS[variant], SIZES[size], className);
  return (
    <button
      ref={ref}
      type={type}
      data-variant={variant}
      className={classes}
      {...props}
    />
  );
});
