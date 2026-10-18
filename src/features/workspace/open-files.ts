import { toast } from "@/components/ui/toast-store";

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/**
 * Single entry point for Open…, Ctrl+O and drops. The viewer (Epic 3) replaces the
 * placeholder toast; no file content is read here.
 */
export function openFiles(files: readonly File[]): void {
  if (files.length === 0) return;
  if (files.some(isPdf)) {
    toast({ title: "Opening drawings arrives with the viewer.", variant: "info" });
  } else {
    toast({ title: "Only PDF files can be opened.", variant: "warning" });
  }
}
