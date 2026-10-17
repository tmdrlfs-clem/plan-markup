"use client";

import type { ReactElement } from "react";
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

export interface StatusBarItemProps {
  label: string;
  icon?: LucideIcon;
  /** A non-default tone always shows its icon so colour is never the only signal. */
  tone?: StatusTone;
  /** Makes the item a button. */
  onClick?: () => void;
  tooltip?: string;
}

/** 24 px status bar cell with tabular numerals. */
export function StatusBarItem({ label, icon, tone = "default", onClick, tooltip }: StatusBarItemProps) {
  const Icon = tone === "default" ? icon : TONE_ICON[tone];
  const classes = cx(
    "num inline-flex h-6 items-center gap-1 whitespace-nowrap px-2 text-ws-xs",
    TONE_TEXT[tone],
    onClick && "rounded-sm focus-ring hover:bg-surface-3",
  );
  const content = (
    <>
      {Icon ? <Icon size={14} aria-hidden="true" className="shrink-0" /> : null}
      <span>{label}</span>
    </>
  );

  const element: ReactElement = onClick ? (
    <button type="button" data-tone={tone} className={classes} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span data-tone={tone} className={classes}>
      {content}
    </span>
  );

  return tooltip ? <Tooltip content={tooltip}>{element}</Tooltip> : element;
}
