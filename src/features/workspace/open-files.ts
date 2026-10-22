import { toast } from "@/components/ui/toast-store";
import { openDocument } from "@/features/viewer";

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/**
 * Single entry point for Open…, Ctrl+O and drops. The first PDF opens in the viewer
 * (read locally, never uploaded); further files wait for tabs (Story 3.5).
 */
export function openFiles(files: readonly File[]): void {
  if (files.length === 0) return;
  const pdf = files.find(isPdf);
  if (!pdf) {
    toast({ title: "Only PDF files can be opened.", variant: "warning" });
    return;
  }
  openDocument(pdf);
  if (files.length > 1) toast({ title: `Tabs arrive soon — opened ${pdf.name}`, variant: "info" });
}
