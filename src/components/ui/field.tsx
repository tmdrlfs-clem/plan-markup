import type { ReactNode } from "react";
import { CircleX } from "lucide-react";

import { cx } from "./cx";

export type FieldLayout = "workspace" | "admin";

/** Control box: workspace 28 px / 13 px text, admin 40 px / 14 px text (UX-DR34). */
export function fieldControlClasses(layout: FieldLayout, invalid: boolean): string {
  return cx(
    "w-full rounded border bg-surface-2 text-text focus-ring disabled:opacity-50",
    "placeholder:text-muted",
    layout === "workspace" ? "h-7 px-2 text-ws-md" : "h-10 px-3 text-ad-sm",
    invalid ? "border-danger" : "border-strong",
  );
}

export interface FieldShellProps {
  layout: FieldLayout;
  label: string;
  /** Id of the labelled control (`htmlFor`). */
  htmlFor: string;
  labelId?: string;
  /** Keep the label for assistive technology but do not draw it. */
  labelHidden?: boolean;
  error?: string;
  errorId?: string;
  children: ReactNode;
}

/** Label + control + inline error. Workspace = label left (96 px column), admin = label above. */
export function FieldShell({
  layout,
  label,
  htmlFor,
  labelId,
  labelHidden,
  error,
  errorId,
  children,
}: FieldShellProps) {
  const workspace = layout === "workspace";
  const labelNode = (
    <label
      id={labelId}
      htmlFor={htmlFor}
      className={cx(
        workspace ? "text-ws-sm text-muted" : "text-ad-sm font-medium text-text",
        labelHidden && "sr-only",
      )}
    >
      {label}
    </label>
  );
  const errorNode = error ? (
    <p
      id={errorId}
      className={cx(
        "flex items-start gap-1 text-danger",
        workspace ? "text-ws-sm" : "text-ws-lg",
        workspace && !labelHidden && "col-start-2",
      )}
    >
      <CircleX size={16} aria-hidden="true" className="mt-px shrink-0" />
      <span>{error}</span>
    </p>
  ) : null;

  if (workspace && !labelHidden) {
    return (
      <div className="grid grid-cols-[96px_1fr] items-center gap-x-2 gap-y-1">
        {labelNode}
        {children}
        {errorNode}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {labelNode}
      {children}
      {errorNode}
    </div>
  );
}
