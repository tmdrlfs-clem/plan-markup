"use client";

import { useEffect } from "react";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * A file dropped outside the drop zone would make the browser open it in place of the
 * workspace. The drop zone handles its own events first (preventDefault); everything
 * else refuses the drop.
 */
export function useFileDropGuard(): void {
  useEffect(() => {
    function onDragOver(event: DragEvent) {
      if (event.defaultPrevented || !hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    }
    function onDrop(event: DragEvent) {
      if (hasFiles(event)) event.preventDefault();
    }
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
}
