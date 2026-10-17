"use client";

import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";
import { useStore } from "zustand";

import { Button } from "./button";
import { cx } from "./cx";
import { IconButton } from "./icon-button";
import { dismiss, toastStore, type ToastItem, type ToastVariant } from "./toast-store";

export const TOAST_DURATION_MS = 4000;

/** Semantic variants always carry an icon; neutral has none. No variant uses the accent colour. */
const VARIANT: Record<Exclude<ToastVariant, "neutral">, { icon: LucideIcon; text: string }> = {
  success: { icon: CircleCheck, text: "text-success" },
  warning: { icon: TriangleAlert, text: "text-warning-text" },
  danger: { icon: CircleX, text: "text-danger" },
  info: { icon: Info, text: "text-info" },
};

function ToastView({ item }: { item: ToastItem }) {
  const variant = item.variant === "neutral" ? null : VARIANT[item.variant];
  const Icon = variant?.icon;

  return (
    <ToastPrimitive.Root
      // A merged duplicate remounts the toast, which restarts the auto-dismiss timer.
      key={`${item.id}-${item.restart}`}
      open
      onOpenChange={(open) => {
        if (!open) dismiss(item.id);
      }}
      duration={TOAST_DURATION_MS}
      type={item.variant === "danger" ? "foreground" : "background"}
      data-variant={item.variant}
      className="flex items-start gap-3 rounded-md border border-strong bg-surface-1 p-3 text-ws-md text-text shadow-2"
    >
      {Icon ? <Icon size={18} aria-hidden="true" className={cx("mt-0.5 shrink-0", variant?.text)} /> : null}
      <div className="min-w-0 flex-1">
        <ToastPrimitive.Title className="flex items-center gap-2 font-semibold">
          <span>{item.title}</span>
          {item.count > 1 ? (
            <span
              role="img"
              aria-label={`${item.count} times`}
              className="num rounded-sm bg-surface-3 px-1 text-ws-xs font-medium text-muted"
            >
              ×{item.count}
            </span>
          ) : null}
        </ToastPrimitive.Title>
        {item.description ? (
          <ToastPrimitive.Description className="mt-0.5 text-muted">{item.description}</ToastPrimitive.Description>
        ) : null}
        {item.action ? (
          <ToastPrimitive.Action altText={item.action.label} asChild>
            <Button size="sm" variant="secondary" className="mt-2" onClick={item.action.onAction}>
              {item.action.label}
            </Button>
          </ToastPrimitive.Action>
        ) : null}
      </div>
      <ToastPrimitive.Close asChild>
        <IconButton label="Dismiss" icon={X} />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

/**
 * Mount once in the workspace layout. Bottom-right, 4 s, pauses on hover and focus,
 * at most 3 visible. F8 moves focus to the toast region.
 */
export function Toaster() {
  const visible = useStore(toastStore, (state) => state.visible);

  return (
    <ToastPrimitive.Provider duration={TOAST_DURATION_MS} swipeDirection="right" label="Notification">
      {visible.map((item) => (
        <ToastView key={item.id} item={item} />
      ))}
      <ToastPrimitive.Viewport
        label="Notifications ({hotkey})"
        className="fixed bottom-4 right-4 z-toast m-0 flex w-[360px] max-w-[calc(100vw-32px)] list-none flex-col gap-2 p-0 outline-none"
      />
    </ToastPrimitive.Provider>
  );
}
