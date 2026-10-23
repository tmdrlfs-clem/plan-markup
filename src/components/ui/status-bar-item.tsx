"use client";

import { forwardRef, type HTMLAttributes, type ReactElement, type Ref } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";

import { cx } from "./cx";
import { Tooltip } from "./tooltip";

export type StatusTone = "default" | "success" | "warning" | "danger" | "info";

const TONE_ICON: Record<Exclude<StatusTone, "default">, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
  info: Info,
};

const TONE_TEXT: Record<StatusTone, string> = {
  default: "text-text",
  success: "text-success",
  warning: "text-warning-text",
  danger: "text-danger",
  info: "text-info",
};

export interface StatusBarItemProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick"> {
  label: string;
  icon?: LucideIcon;
  /** A non-default tone always shows its icon so colour is never the only signal. */
  tone?: StatusTone;
  /** Makes the item a button. */
  onClick?: () => void;
  /**
   * A button without its own onClick: a menu trigger (Story 3.7's zoom item)
   * hands it its handlers through `asChild`.
   */
  asButton?: boolean;
  /** The label is for assistive technology only; the icon shows (narrow status bars). */
  iconOnly?: boolean;
  tooltip?: string;
}

/** 24 px status bar cell with tabular numerals. */
export const StatusBarItem = forwardRef<HTMLElement, StatusBarItemProps>(function StatusBarItem(
  { label, icon, tone = "default", onClick, asButton = false, iconOnly = false, tooltip, className, ...rest },
  ref,
) {
  const Icon = tone === "default" ? icon : TONE_ICON[tone];
  const button = asButton || onClick !== undefined;
  const classes = cx(
    "num inline-flex h-6 items-center gap-1 whitespace-nowrap px-2 text-ws-xs",
    TONE_TEXT[tone],
    button && "rounded-sm focus-ring hover:bg-surface-3",
    className,
  );
  const content = (
    <>
      {Icon ? <Icon size={14} aria-hidden="true" className="shrink-0" /> : null}
      <span className={iconOnly ? "sr-only" : "min-w-0 truncate"}>{label}</span>
    </>
  );

  const element: ReactElement = button ? (
    <button
      type="button"
      data-tone={tone}
      className={classes}
      onClick={onClick}
      {...rest}
      ref={ref as Ref<HTMLButtonElement>}
    >
      {content}
    </button>
  ) : (
    <span data-tone={tone} className={classes} {...rest} ref={ref as Ref<HTMLSpanElement>}>
      {content}
    </span>
  );

  return tooltip ? <Tooltip content={tooltip} side="top">{element}</Tooltip> : element;
});
