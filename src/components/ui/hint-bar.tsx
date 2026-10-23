"use client";

import { CircleX, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { useStore } from "zustand";

import { Button } from "./button";
import { cx } from "./cx";
import { dismissHint, hintStore, type HintVariant } from "./hint-store";
import { IconButton } from "./icon-button";

const VARIANT: Record<HintVariant, { icon: LucideIcon; text: string }> = {
  info: { icon: Info, text: "text-info" },
  warning: { icon: TriangleAlert, text: "text-warning-text" },
  danger: { icon: CircleX, text: "text-danger" },
};

/**
 * Thin bar for file-level notices (UX-DR11): under the toolbar, in the layout flow so it
 * never covers the canvas; icon + text + optional action + Dismiss; one notice at a time
 * (hint-store). Renders nothing when there is no notice.
 */
export function HintBar() {
  const hint = useStore(hintStore, (state) => state.hint);
  if (!hint) return null;
  const { icon: Icon, text } = VARIANT[hint.variant];
  return (
    <div
      role={hint.variant === "danger" ? "alert" : "status"}
      data-testid="hint-bar"
      data-variant={hint.variant}
      className="flex h-8 items-center gap-2 border-b border-border bg-surface-1 pl-3 pr-1 text-ws-md text-text"
    >
      <Icon size={16} aria-hidden="true" className={cx("shrink-0", text)} />
      <span className="min-w-0 flex-1 truncate">{hint.text}</span>
      {hint.action ? (
        <Button size="sm" variant="secondary" onClick={hint.action.onAction}>
          {hint.action.label}
        </Button>
      ) : null}
      <IconButton
        label="Dismiss"
        icon={X}
        onClick={() => {
          dismissHint(hint.id);
          hint.onDismiss?.();
        }}
      />
    </div>
  );
}
