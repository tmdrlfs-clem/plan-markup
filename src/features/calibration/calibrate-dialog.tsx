"use client";

// The CalibrateDialog (Story 4.3, FR24, UX-DR18): use a detected scale, type a
// ratio (with an optional "@ sheet", converted like 4.2), or pick two points a
// known distance apart (the dialog collapses to an instruction bar while
// picking); apply to this page, a range or all pages, optionally with a
// separate vertical scale; display unit and precision. Story 1.7 parts only.

import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { FieldShell, fieldControlClasses } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DISPLAY_UNITS,
  MM_PER_POINT,
  factorFromPoints,
  mixedSizes,
  ratioForPage,
  type CalibrationInput,
  type DisplayUnit,
  type Precision,
} from "@/core/calibration/calibration";
import { parsePageRange, parseRatioInput } from "@/core/calibration/range";
import { INPUT_UNITS, formatReal, parseDistance, precisionLabel, precisionsFor, type InputUnit } from "@/core/calibration/units";
import { sheetSize } from "@/core/pdf/page-size";
import { conflictWarning, readingLabel, scaleLabel, type DetectedScale, type ScaleReading } from "@/core/scale/detect";
import { canonicalSheet, niceRatio } from "@/core/scale/sheet";
import { FirstUseTip } from "@/features/tips";
import { viewerStore } from "@/features/viewer";

import { applyCalibration, calibrateStore, cancelPicking, closeCalibrate, setCalibrateDraft, startPicking, type CalibrateScope } from "./calibrate-store";

const UNIT_LABEL: Record<DisplayUnit, string> = { mm: "Millimetres (mm)", m: "Metres (m)", in: "Inches (in)", "ft-in": "Feet-inches (ft-in)" };
const INPUT_UNIT_LABEL: Record<InputUnit, string> = { mm: "mm", m: "m", in: "in", ft: "ft", "ft-in": "ft-in" };

/** A workspace text field (Story 1.7 FieldShell + control classes) with tabular figures. */
function TextInput({
  label,
  error,
  focusOnMount = false,
  ...props
}: { label: string; error?: string; focusOnMount?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  // After the dialog's own first-field focus (the method tabs come first in the body).
  useEffect(() => {
    if (!focusOnMount) return;
    const frame = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusOnMount]);
  return (
    <FieldShell layout="workspace" label={label} htmlFor={id} error={error} errorId={`${id}-error`}>
      <input
        ref={ref}
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${fieldControlClasses("workspace", Boolean(error))} num`}
        {...props}
      />
    </FieldShell>
  );
}

/** "Use detected 1:200 (1:100 @ A1)": the ratio on this page first when the sheet converts it. */
function detectedLabel(r: ScaleReading, imperial: boolean, text: string): string {
  if (imperial) return `Use detected ${text} (1:${r.effective})`;
  return r.effective === r.ratio || !r.sheet ? `Use detected ${readingLabel(r)}` : `Use detected 1:${r.effective} (${readingLabel(r)})`;
}

/** Buttons for the detected scales of the page (AC 1), with the conflict warning (AC 6). */
function DetectedSection({ scales, onUse }: { scales: DetectedScale[]; onUse: (r: ScaleReading) => void }) {
  if (scales.length === 0) return null;
  return (
    <section aria-label="Detected scales" className="mb-3 flex flex-col gap-2" data-testid="calibrate-detected">
      {scales.map((s, i) =>
        s.conflict ? (
          <div key={i} className="flex flex-col gap-2 rounded-sm border border-strong bg-surface-2 p-2">
            <p role="alert" className="flex items-start gap-2 text-ws-sm text-warning-text" data-testid="calibrate-conflict">
              <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span className="num">{conflictWarning(s)}. Check which one the drawing was set out at.</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {s.readings.map((r) => (
                <Button key={`${r.ratio}@${r.sheet}`} variant="secondary" size="sm" className="num" onClick={() => onUse(r)}>
                  {`Use ${readingLabel(r)} (1:${r.effective} on this page)`}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <Button key={i} variant="secondary" size="sm" className="num self-start" onClick={() => onUse({ ratio: s.ratio, sheet: s.sheet, effective: s.effective, text: s.text })}>
            {detectedLabel({ ratio: s.ratio, sheet: s.sheet, effective: s.effective, text: s.text }, s.imperial, scaleLabel(s))}
          </Button>
        ),
      )}
    </section>
  );
}

/** The Calibrate dialog and, while picking, its instruction bar. Mounted once by the workspace shell. */
export function CalibrateDialog() {
  const session = useStore(calibrateStore, (s) => s.session);
  return <CalibrateBody key={session} />;
}

function CalibrateBody() {
  const ui = useStore(calibrateStore);
  const pages = useStore(viewerStore, (s) => s.pages);
  const pageScales = useStore(viewerStore, (s) => s.pageScales[ui.pageIndex] ?? null);
  const [errors, setErrors] = useState<{ ratio?: string; distance?: string; range?: string; yRatio?: string }>({});
  const page = pages[ui.pageIndex];
  const pageCount = pages.length;

  if (!ui.open) return null;
  if (ui.picking) return <PickBar step={ui.pickStep} />;
  if (!page) return null;

  const size = sheetSize(page.width, page.height);
  const scopePages = (): { ok: true; pages: number[] } | { ok: false; message: string } => {
    if (ui.scope === "page") return { ok: true, pages: [ui.pageIndex] };
    if (ui.scope === "all") return { ok: true, pages: pages.map((_, i) => i) };
    return parsePageRange(ui.rangeText, pageCount);
  };
  const scope = scopePages();
  const mixed = scope.ok && mixedSizes(scope.pages.map((i) => pages[i]));
  const ratioDraft = parseRatioInput(ui.ratioText, canonicalSheet);
  const conversion =
    ui.method === "ratio" && ratioDraft.ok && ratioDraft.value.sheet && ratioDraft.value.sheet !== size.name
      ? `1:${ratioDraft.value.ratio} @ ${ratioDraft.value.sheet} → 1:${niceRatio(ratioForPage(ratioDraft.value.ratio, ratioDraft.value.sheet, page))} on this ${size.name ?? ""} page`.replace("  ", " ")
      : null;

  /** The vertical ratio, when the section is open and filled; an error message when it is unreadable. */
  const yRatio = (): { ok: true; value?: number } | { ok: false; message: string } => {
    if (!ui.verticalOpen || ui.yRatioText.trim() === "") return { ok: true };
    const r = parseRatioInput(ui.yRatioText, () => null);
    return r.ok ? { ok: true, value: r.value.ratio } : { ok: false, message: "Enter a ratio like 1:50" };
  };

  const apply = (input: CalibrationInput, extra: Partial<typeof errors> = {}) => {
    const y = yRatio();
    const next = { ...extra, range: scope.ok ? undefined : scope.message, yRatio: y.ok ? undefined : y.message };
    setErrors(next);
    if (!scope.ok || !y.ok || Object.values(next).some(Boolean)) return;
    if (applyCalibration({ ...input, yRatio: y.value }, scope.pages, { unit: ui.unit, precision: ui.precision })) closeCalibrate();
  };

  const useDetected = (r: ScaleReading) => apply({ kind: "detected", ratio: r.sheet ? r.ratio : r.effective, sheet: r.sheet });

  const applyPrimary = () => {
    if (ui.method === "ratio") {
      if (!ratioDraft.ok) return setErrors({ ratio: ratioDraft.message });
      return apply({ kind: "ratio", ratio: ratioDraft.value.ratio, sheet: ratioDraft.value.sheet });
    }
    if (!ui.pick) return startPicking();
    const distance = parseDistance(ui.distanceText, ui.distanceUnit);
    if (!distance.ok) return setErrors({ distance: distance.message });
    apply({ kind: "points", factor: factorFromPoints(ui.pick.distancePt, distance.mm) });
  };

  // Review R9: a vertical ratio is stated for the same sheet as the ratio (converted the same way): say so.
  const yDraft = yRatio();
  const verticalNote =
    ui.method === "ratio" && ratioDraft.ok && ratioDraft.value.sheet && yDraft.ok && yDraft.value
      ? `Stated for ${ratioDraft.value.sheet} like the ratio: 1:${niceRatio(ratioForPage(yDraft.value, ratioDraft.value.sheet, page))} on this page`
      : null;

  const unitOptions = DISPLAY_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }));
  const precisionOptions = precisionsFor(ui.unit).map((p) => ({ value: p, label: precisionLabel(p) }));
  const pickedDistance = ui.pick ? `${formatReal(ui.pick.distancePt * MM_PER_POINT, "mm", "0.0")} on paper (${ui.pick.distancePt.toFixed(1)} pt)` : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeCalibrate();
      }}
      title="Calibrate"
      description={`Page ${ui.pageIndex + 1} of ${pageCount} · ${size.label}`}
      size="md"
      footer={
        <DialogFooter
          secondary={
            <Button variant="secondary" onClick={closeCalibrate}>
              Cancel
            </Button>
          }
          primary={<DialogPrimary onClick={applyPrimary}>{ui.method === "points" && !ui.pick ? "Pick two points" : "Apply"}</DialogPrimary>}
        />
      }
    >
      <FirstUseTip id="calibrate" session={ui.session}>
        Use a printed scale when the drawing has one. Otherwise pick the two ends of a long dimension you know (they snap to the
        linework) and type its length.
      </FirstUseTip>
      <DetectedSection scales={pageScales?.scales ?? []} onUse={useDetected} />

      <Tabs value={ui.method} onValueChange={(v) => setCalibrateDraft({ method: v as typeof ui.method })}>
        <TabsList aria-label="Calibrate by">
          <TabsTrigger value="ratio">By ratio</TabsTrigger>
          <TabsTrigger value="points">By two points</TabsTrigger>
        </TabsList>
        <TabsContent value="ratio" className="flex flex-col gap-2">
          <TextInput
            label="Ratio"
            placeholder="1:100 or 1:100 @ A1"
            value={ui.ratioText}
            error={errors.ratio}
            onChange={(e) => setCalibrateDraft({ ratioText: e.target.value })}
            focusOnMount
            data-testid="calibrate-ratio"
          />
          {conversion ? (
            <p className="num pl-[104px] text-ws-sm text-muted" data-testid="calibrate-conversion">
              {conversion}
            </p>
          ) : null}
        </TabsContent>
        <TabsContent value="points" className="flex flex-col gap-2">
          {ui.pickError ? (
            <p role="alert" className="text-ws-sm text-danger" data-testid="calibrate-pick-error">
              {ui.pickError}
            </p>
          ) : null}
          {ui.pick ? (
            <>
              <p className="num text-ws-sm text-muted" data-testid="calibrate-picked">
                Picked: {pickedDistance}
              </p>
              <div className="grid grid-cols-[1fr_auto] items-start gap-2">
                <TextInput
                  label="Real distance"
                  placeholder={ui.distanceUnit === "ft-in" ? `12'-6"` : "1905"}
                  value={ui.distanceText}
                  error={errors.distance}
                  onChange={(e) => setCalibrateDraft({ distanceText: e.target.value })}
                  focusOnMount
                  data-testid="calibrate-distance"
                />
                <div className="w-24">
                  <Select
                    label="Distance unit"
                    value={ui.distanceUnit}
                    onValueChange={(v) => setCalibrateDraft({ distanceUnit: v as InputUnit })}
                    options={INPUT_UNITS.map((u) => ({ value: u, label: INPUT_UNIT_LABEL[u] }))}
                  />
                </div>
              </div>
              <Button variant="secondary" size="sm" className="self-start" onClick={startPicking}>
                Pick again
              </Button>
            </>
          ) : (
            <p className="text-ws-sm text-muted">Pick two points a known distance apart on this page, then type that distance.</p>
          )}
        </TabsContent>
      </Tabs>

      <div className="mt-3 flex flex-col gap-2">
        <Select
          label="Apply to"
          value={ui.scope}
          onValueChange={(v) => setCalibrateDraft({ scope: v as CalibrateScope })}
          options={[
            { value: "page", label: `This page (${ui.pageIndex + 1})` },
            { value: "range", label: "Pages…" },
            { value: "all", label: `All pages (${pageCount})` },
          ]}
        />
        {ui.scope === "range" ? (
          <TextInput
            label="Pages"
            placeholder="1-3, 5"
            value={ui.rangeText}
            error={errors.range}
            onChange={(e) => setCalibrateDraft({ rangeText: e.target.value })}
            data-testid="calibrate-range"
          />
        ) : null}
        {mixed ? (
          <p className="text-ws-sm text-muted" data-testid="calibrate-mixed">
            {ui.method === "ratio"
              ? "These pages have different sheet sizes: the ratio applies to each page as a ratio (one stated for a sheet is converted for each page)."
              : "These pages have different sheet sizes: the same factor (real length per point of the page) applies to each page."}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Select
            label="Units"
            value={ui.unit}
            onValueChange={(v) => {
              const unit = v as DisplayUnit;
              setCalibrateDraft({ unit, precision: precisionsFor(unit).includes(ui.precision) ? ui.precision : precisionsFor(unit)[0] });
            }}
            options={unitOptions}
          />
          <Select label="Precision" value={ui.precision} onValueChange={(v) => setCalibrateDraft({ precision: v as Precision })} options={precisionOptions} />
        </div>
      </div>

      <Collapsible title="Different vertical scale" open={ui.verticalOpen} onOpenChange={(open) => setCalibrateDraft({ verticalOpen: open })} className="mt-3 border-t">
        <TextInput
          label="Vertical ratio"
          placeholder="1:50"
          value={ui.yRatioText}
          error={errors.yRatio}
          onChange={(e) => setCalibrateDraft({ yRatioText: e.target.value })}
          data-testid="calibrate-y-ratio"
        />
        {verticalNote ? (
          <p className="num pl-[104px] text-ws-sm text-muted" data-testid="calibrate-y-note">
            {verticalNote}
          </p>
        ) : null}
      </Collapsible>
    </Dialog>
  );
}

/** The collapsed dialog while picking (AC 2): announced politely; Esc or Cancel brings the dialog back. */
function PickBar({ step }: { step: 1 | 2 }) {
  return (
    <div
      data-testid="calibrate-pick-bar"
      className="fixed left-1/2 top-24 z-popover flex -translate-x-1/2 items-center gap-3 rounded-sm border border-strong bg-surface-1 py-1 pl-3 pr-1 text-ws-md text-text shadow-2"
    >
      <span role="status" aria-live="polite">
        {step === 1 ? "Click the first point · Esc to cancel" : "Click the second point · Esc to cancel"}
      </span>
      <Button variant="secondary" size="sm" onClick={cancelPicking}>
        Cancel
      </Button>
    </div>
  );
}
