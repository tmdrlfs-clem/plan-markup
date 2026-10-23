import { toast } from "@/components/ui/toast-store";
import { openDocuments } from "@/features/viewer";

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/**
 * Single entry point for Open…, Ctrl+O and drops. Every PDF opens in its own
 * document tab (read locally, never uploaded; Story 3.5); the last one is shown.
 * Other files are skipped with a warning.
 */
export function openFiles(files: readonly File[]): void {
  if (files.length === 0) return;
  const pdfs = files.filter(isPdf);
  if (pdfs.length === 0) {
    toast({ title: "Only PDF files can be opened.", variant: "warning" });
    return;
  }
  openDocuments(pdfs);
  if (pdfs.length < files.length) toast({ title: "Only PDF files can be opened; the others were skipped.", variant: "warning" });
}
