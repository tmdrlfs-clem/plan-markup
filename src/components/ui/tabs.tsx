"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cx } from "./cx";

/** Automatic activation: arrows move and select, Home / End jump to the first / last tab. */
export const Tabs = forwardRef<
  ElementRef<typeof TabsPrimitive.Root>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(function Tabs({ activationMode = "automatic", ...props }, ref) {
  return <TabsPrimitive.Root ref={ref} activationMode={activationMode} {...props} />;
});

export type TabsListProps = Omit<ComponentPropsWithoutRef<typeof TabsPrimitive.List>, "aria-label"> & {
  /** Required: names the tab list. */
  "aria-label": string;
};

export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  function TabsList({ className, ...props }, ref) {
    return (
      <TabsPrimitive.List
        ref={ref}
        className={cx("flex items-end gap-1 border-b border-border", className)}
        {...props}
      />
    );
  },
);

/** Active tab = text colour plus a 2 px accent bottom border (not colour alone). */
export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cx(
        "-mb-px h-8 select-none border-b-2 border-transparent px-3 text-ws-md text-muted focus-ring",
        "hover:text-text data-[state=active]:border-accent data-[state=active]:text-text",
        "data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cx("pt-3 focus-ring", className)} {...props} />;
});
