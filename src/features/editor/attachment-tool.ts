// File attachment (Bluebeam toolbar set, founder 2026-11-21). The rail's
// Attachment button picks a file (at most 5 MB); Attachment is then armed and a
// click places a paperclip carrying it; Select then has it. Properties' Save
// file downloads the file again.

import { createStore } from "zustand/vanilla";

import { toast } from "@/components/ui/toast-store";
import { uuidv7 } from "@/core/ids/uuid";
import { MAX_ATTACHMENT_BYTES, attachmentMime, attachmentName, fromBase64, sizeText, toBase64 } from "@/core/markup/attachment";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { setTool } from "@/features/viewer";

type Point = { x: number; y: number };

export const ADD_ATTACHMENT = "Add attachment";
export const ATTACHMENT_FAILED = "The file could not be attached.";

export type PickedFile = { name: string; mime: string; data: string };

/** The file waiting for its click (Attachment is armed while there is one). */
export const attachmentStore = createStore<{ picked: PickedFile | null }>(() => ({ picked: null }));
export const pickedAttachment = (): PickedFile | null => attachmentStore.getState().picked;
export function clearPickedAttachment(): void {
  if (attachmentStore.getState().picked) attachmentStore.setState({ picked: null });
}

/** Reads `file`; when it is small enough it waits to be placed and Attachment is armed. True when it was picked. */
export async function pickAttachmentFile(file: File): Promise<boolean> {
  if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) {
    toast({
      title: ATTACHMENT_FAILED,
      description: file.size === 0 ? "The file is empty." : `It is ${sizeText(file.size)}; the most is ${sizeText(MAX_ATTACHMENT_BYTES)}.`,
      variant: "warning",
    });
    return false;
  }
  let data: string;
  try {
    data = toBase64(new Uint8Array(await file.arrayBuffer()));
  } catch {
    toast({ title: ATTACHMENT_FAILED, description: "The file could not be read.", variant: "warning" });
    return false;
  }
  attachmentStore.setState({ picked: { name: attachmentName(file.name), mime: attachmentMime(file.type), data } });
  setTool("attachment");
  return true;
}

/** The attachment markup for `picked`, its paperclip centred at `at`. */
export function attachmentMarkupAt(picked: PickedFile, at: Point, pageId: string): Markup {
  return { id: uuidv7(), pageId, createdAt: new Date().toISOString(), style: { ...DEFAULT_MARKUP_STYLE, color: "#334155" }, type: "attachment", points: [at], ...picked };
}

/** Saves an attachment's file (the browser's download). */
export function saveAttachment(m: { name: string; mime: string; data: string }): void {
  const bytes = fromBase64(m.data);
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: m.mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = m.name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
