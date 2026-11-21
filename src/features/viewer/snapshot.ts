// Snapshot (Bluebeam toolbar set, founder 2026-11-21): the box dragged out with
// the Snapshot tool, the sheet and its markups as shown, goes to the system
// clipboard as a PNG, to paste into a report, an email or a chat.

import { toast } from "@/components/ui/toast-store";

export const SNAPSHOT_COPIED = "Snapshot copied";
export const SNAPSHOT_FAILED = "Could not copy the snapshot";

/** Puts `canvas` on the clipboard as a PNG and says so (or that the browser would not). */
export function copySnapshot(canvas: HTMLCanvasElement): void {
  const failed = () => toast({ title: SNAPSHOT_FAILED, description: "The browser did not allow images on the clipboard.", variant: "danger" });
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    failed();
    return;
  }
  // The item takes the PNG as a promise, so the write starts inside the user's gesture (Safari).
  const png = new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
  navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).then(
    () => toast({ title: SNAPSHOT_COPIED, description: `${canvas.width} × ${canvas.height} px: paste it where you need it.`, variant: "success" }),
    failed,
  );
}
