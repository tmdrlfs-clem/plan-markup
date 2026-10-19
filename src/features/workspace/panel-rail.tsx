"use client";

import { Toolbar, ToolbarToggleGroup, ToolbarToggleItem } from "@/components/ui/toolbar";

import { useLayout } from "./layout-context";
import { LEFT_PANELS, type LeftPanelId } from "./panel-registry";

/** Left 44 px icon rail. Pressed = that panel is open; pressing it again collapses the panel. */
export function PanelRail() {
  const left = useLayout((s) => s.left);
  const showLeftPanel = useLayout((s) => s.showLeftPanel);
  const setLeftCollapsed = useLayout((s) => s.setLeftCollapsed);

  return (
    <Toolbar aria-label="Panel switcher" orientation="vertical" className="h-full overflow-y-auto">
      <ToolbarToggleGroup
        type="single"
        aria-label="Panels"
        className="flex-col"
        value={left.collapsed ? "" : left.active}
        onValueChange={(value) => {
          if (value) showLeftPanel(value as LeftPanelId);
          else setLeftCollapsed(true);
        }}
      >
        {LEFT_PANELS.map((panel) => (
          <ToolbarToggleItem
            key={panel.id}
            value={panel.id}
            data-panel-id={panel.id}
            label={panel.title}
            icon={panel.icon}
            shortcut={panel.shortcut}
            size="md"
          />
        ))}
      </ToolbarToggleGroup>
    </Toolbar>
  );
}
