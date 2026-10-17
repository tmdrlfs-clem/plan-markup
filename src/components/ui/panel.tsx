"use client";

import {
  useId,
  useRef,
  useState,
  type AriaRole,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import { cx } from "./cx";
import { IconButton } from "./icon-button";

export type PanelSide = "left" | "right" | "bottom";

export interface PanelProps {
  title: string;
  side: PanelSide;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Width (left / right) or height (bottom) in px, applied while expanded. */
  size: number;
  onSizeChange: (size: number) => void;
  minSize: number;
  maxSize: number;
  actions?: ReactNode;
  /** Landmark role chosen by the shell (e.g. "complementary"); defaults to a labelled region. */
  role?: AriaRole;
  children: ReactNode;
  className?: string;
}

const ICONS = {
  left: { close: PanelLeftClose, open: PanelLeftOpen },
  right: { close: PanelRightClose, open: PanelRightOpen },
  bottom: { close: PanelBottomClose, open: PanelBottomOpen },
} as const;

const KEY_STEP = 8;
const KEY_STEP_LARGE = 32;

/**
 * Collapsible, resizable panel. Fully controlled: the caller owns `size` and
 * `collapsed` and persists them. The resize handle is a keyboard-operable separator.
 */
export function Panel({
  title,
  side,
  collapsed,
  onCollapsedChange,
  size,
  onSizeChange,
  minSize,
  maxSize,
  actions,
  role,
  children,
  className,
}: PanelProps) {
  const bodyId = useId();
  const drag = useRef<{ start: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const horizontalResize = side !== "bottom"; // left / right panels resize along x
  // +1 when moving the pointer to the right / down makes the panel bigger.
  const pointerSign = side === "left" ? 1 : -1;
  // Key that grows the panel.
  const growKey = side === "left" ? "ArrowRight" : side === "right" ? "ArrowLeft" : "ArrowUp";
  const shrinkKey = side === "left" ? "ArrowLeft" : side === "right" ? "ArrowRight" : "ArrowDown";

  const clamp = (value: number) => Math.min(maxSize, Math.max(minSize, value));
  const Icons = ICONS[side];
  const CollapseIcon = collapsed ? Icons.open : Icons.close;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    switch (event.key) {
      case growKey:
        onSizeChange(clamp(size + step));
        break;
      case shrinkKey:
        onSizeChange(clamp(size - step));
        break;
      case "Home":
        onSizeChange(minSize);
        break;
      case "End":
        onSizeChange(maxSize);
        break;
      case "Enter":
        onCollapsedChange(!collapsed);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: horizontalResize ? event.clientX : event.clientY, size };
    setDragging(true);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const position = horizontalResize ? event.clientX : event.clientY;
    onSizeChange(clamp(drag.current.size + pointerSign * (position - drag.current.start)));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragging(false);
  }

  const handleClasses = cx(
    "group absolute z-panel flex touch-none items-center justify-center focus-ring",
    side === "left" && "inset-y-0 -right-1 w-2 cursor-col-resize",
    side === "right" && "inset-y-0 -left-1 w-2 cursor-col-resize",
    side === "bottom" && "inset-x-0 -top-1 h-2 cursor-row-resize",
  );
  const barClasses = cx(
    "bg-transparent group-hover:bg-accent group-focus-visible:bg-accent group-data-[dragging=true]:bg-accent",
    horizontalResize ? "h-full w-1" : "h-1 w-full",
  );

  return (
    <section
      role={role}
      aria-label={title}
      data-side={side}
      data-collapsed={collapsed}
      style={collapsed ? undefined : horizontalResize ? { width: size } : { height: size }}
      className={cx("relative z-panel flex min-h-0 min-w-0 flex-col bg-surface-1 text-text", className)}
    >
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border pl-3 pr-1">
        <h2 className="min-w-0 flex-1 truncate text-ws-sm font-semibold">{title}</h2>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
        <IconButton
          label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
          icon={CollapseIcon}
          aria-controls={bodyId}
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        />
      </header>
      <div id={bodyId} hidden={collapsed} className="min-h-0 flex-1 overflow-auto">
        {children}
      </div>
      {collapsed ? null : (
        <div
          role="separator"
          tabIndex={0}
          aria-label={`Resize ${title}`}
          aria-orientation={horizontalResize ? "vertical" : "horizontal"}
          aria-valuenow={size}
          aria-valuemin={minSize}
          aria-valuemax={maxSize}
          aria-controls={bodyId}
          data-dragging={dragging}
          className={handleClasses}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span aria-hidden="true" className={barClasses} />
        </div>
      )}
    </section>
  );
}
