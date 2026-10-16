/** Geometry is stored in PDF points; millimetres appear only at display time. */
export const PT_PER_INCH = 72;
export const MM_PER_INCH = 25.4;

export function ptToMm(pt: number): number {
  return (pt * MM_PER_INCH) / PT_PER_INCH;
}

export function mmToPt(mm: number): number {
  return (mm * PT_PER_INCH) / MM_PER_INCH;
}
