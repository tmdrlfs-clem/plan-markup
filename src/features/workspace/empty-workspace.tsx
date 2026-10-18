"use client";

import { FileUp } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";

export interface RecentDrawing {
  id: string;
  name: string;
}

export interface EmptyWorkspaceProps {
  /** Opens the file picker (shared with File › Open…, the toolbar and Ctrl+O). */
  onOpen: () => void;
  /** Dropped files. */
  onOpenFiles: (files: File[]) => void;
  /** Local history; empty until the viewer keeps one. */
  recent: readonly RecentDrawing[];
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Canvas area before a drawing is open: drop zone, Open and recent drawings (UX-DR30). */
export function EmptyWorkspace({ onOpen, onOpenFiles, recent }: EmptyWorkspaceProps) {
  // dragenter/dragleave fire for every child; count them so the state does not flicker.
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  function onDragEnter(event: DragEvent<HTMLElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current += 1;
    setDragging(true);
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave() {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    onOpenFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      data-testid="drop-zone"
      data-dragging={dragging || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="flex h-full min-h-0 w-full items-center justify-center overflow-auto p-6"
    >
      <div
        className={cx(
          "flex w-full max-w-[440px] flex-col items-center gap-4 rounded-lg border-2 border-dashed px-8 py-10 text-center",
          dragging ? "border-accent bg-surface-1" : "border-border",
        )}
      >
        <FileUp size={32} aria-hidden="true" className="text-muted" />
        <h1 className="text-ws-xl font-semibold">{dragging ? "Drop to open" : "Drop a PDF here or Open…"}</h1>
        <Button variant="primary" size="sm" onClick={onOpen}>
          Open…
        </Button>
        <section aria-labelledby="recent-drawings" className="mt-2 w-full text-left">
          <h2 id="recent-drawings" className="text-ws-sm font-semibold text-muted">
            Recent drawings
          </h2>
          {recent.length === 0 ? (
            <p className="mt-1 text-ws-md text-muted">No recent drawings</p>
          ) : (
            <ul className="mt-1 flex flex-col">
              {recent.map((drawing) => (
                <li key={drawing.id} className="truncate text-ws-md">
                  {drawing.name}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
