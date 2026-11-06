"use client";

// Story 6.3 (UX-DR10): the SaveIndicator in the status bar. Five states:
// ✓ Saved · Saving… · ⚠ Offline — n changes waiting · ✕ Not synced — Retry ·
// Local only — Sign in to save. A click opens the details: when it last saved,
// how many changes wait, and Retry. The work is safe in every state (the
// local queue keeps it).

import { useStore } from "zustand";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { StatusBarItem, type StatusTone } from "@/components/ui/status-bar-item";

import { saveNow, saveStatusStore, type SaveStatus } from "./sync";

const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;

/** The indicator's label and tone for a status. */
export function saveLabel(status: SaveStatus): { label: string; tone: StatusTone } {
  switch (status.state) {
    case "saved":
      return { label: "Saved", tone: "success" };
    case "saving":
      return { label: "Saving…", tone: "default" };
    case "offline":
      return { label: `Offline — ${changes(status.pending)} waiting`, tone: "warning" };
    case "error":
      return { label: "Not synced — Retry", tone: "danger" };
    case "local":
      return { label: "Local only — Sign in to save", tone: "warning" };
  }
}

function savedAt(ms: number | null): string {
  if (ms === null) return "Not saved yet in this session";
  return `Last saved at ${new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

export function SaveIndicator() {
  const status = useStore(saveStatusStore);
  const { label, tone } = saveLabel(status);
  return (
    <Popover
      side="top"
      align="end"
      aria-label="Save status"
      trigger={
        <StatusBarItem
          label={label}
          tone={tone}
          icon={status.state === "saving" ? RefreshCw : undefined}
          asButton
          tooltip="Save status (Ctrl+S saves now)"
          data-testid="status-save"
          data-state={status.state}
          data-pending={status.pending}
        />
      }
    >
      <div className="flex w-64 flex-col gap-2" data-testid="save-details">
        <p className="font-medium">{label}</p>
        <p className="text-muted">{savedAt(status.lastSavedAt)}</p>
        <p className="text-muted">{status.pending > 0 ? `${changes(status.pending)} waiting on this computer` : "Nothing waiting"}</p>
        {status.state === "local" ? (
          <p className="text-muted">
            Your session expired. Your changes stay on this computer:{" "}
            <a className="underline focus-ring" href="/sign-in" target="_blank" rel="noopener">
              sign in
            </a>{" "}
            again, then Retry.
          </p>
        ) : null}
        {status.pending > 0 || status.state === "error" ? (
          <Button size="sm" onClick={saveNow} className="self-start">
            Retry
          </Button>
        ) : null}
      </div>
    </Popover>
  );
}
