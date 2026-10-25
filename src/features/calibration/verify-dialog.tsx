"use client";

// The VerifyDialog (Story 4.4, FR25, NFR8): pick the two ends of a dimension
// you know on a calibrated page and compare the measured length with it, at
// the calibration's unit and precision. Keep closes it; Recalibrate… hands
// the pick and the known distance to the Calibrate dialog. Story 1.7 parts only.

import { CircleCheck, TriangleAlert } from "lucide-react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { calibrationLabel, type Calibration } from "@/core/calibration/calibration";
import { INPUT_UNITS, type InputUnit } from "@/core/calibration/units";
import { formatPercent, verifyCalibration, type VerifyResult } from "@/core/calibration/verify";
import { viewerStore } from "@/features/viewer";

import { calibrationOf } from "./calibrate-store";
import { PickBar, TextInput } from "./calibration-fields";
import { cancelVerifyPick, closeVerify, knownDistance, recalibrate, setVerifyDraft, startVerifyPick, verifyStore } from "./verify-store";

/** The Verify dialog and, while picking, its instruction bar. Mounted once by the workspace shell. */
export function VerifyDialog() {
  const session = useStore(verifyStore, (s) => s.session);
  return <VerifyBody key={session} />;
}

function VerifyBody() {
  const ui = useStore(verifyStore);
  const pages = useStore(viewerStore, (s) => s.pages);
  const calibration = useStore(viewerStore, (s) => calibrationOf(s, ui.pageIndex));
  const page = pages[ui.pageIndex];

  if (!ui.open) return null;
  if (ui.picking) return <PickBar step={ui.pickStep} onCancel={cancelVerifyPick} />;
  if (!page || !calibration) return null;

  const known = knownDistance(ui);
  const result = ui.pick ? verifyCalibration(ui.pick, calibration, known.mm) : null;
  const off = result?.matches === false;
  const canRecalibrate = Boolean(ui.pick) && known.mm !== null;

  const keep = (
    <Button variant="secondary" onClick={closeVerify}>
      Keep
    </Button>
  );
  const recalibrateButton = (
    <Button variant="secondary" disabled={!canRecalibrate} onClick={() => void recalibrate()}>
      Recalibrate…
    </Button>
  );
  let footer;
  if (!ui.pick) {
    footer = (
      <DialogFooter
        secondary={
          <Button variant="secondary" onClick={closeVerify}>
            Cancel
          </Button>
        }
        primary={<DialogPrimary onClick={startVerifyPick}>Pick two points</DialogPrimary>}
      />
    );
  } else if (off) {
    // Off: recalibrating is the likely next step (it still goes through Calibrate → Apply).
    footer = <DialogFooter secondary={keep} primary={<DialogPrimary onClick={() => void recalibrate()}>Recalibrate…</DialogPrimary>} />;
  } else {
    footer = <DialogFooter secondary={recalibrateButton} primary={<DialogPrimary onClick={closeVerify}>Keep</DialogPrimary>} />;
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeVerify();
      }}
      title="Verify calibration"
      description={`Page ${ui.pageIndex + 1} of ${pages.length} · ${calibrationLabel(calibration, page.rotate).label}`}
      size="md"
      footer={footer}
    >
      <div className="flex flex-col gap-2">
        <p className="text-ws-sm text-muted">Pick the two ends of a dimension you know and compare it with the calibration.</p>
        {ui.pickError ? (
          <p role="alert" className="text-ws-sm text-danger" data-testid="verify-pick-error">
            {ui.pickError}
          </p>
        ) : null}
        <div className="grid grid-cols-[1fr_auto] items-start gap-2">
          <TextInput
            label="Known distance"
            placeholder={ui.knownUnit === "ft-in" ? `12'-6"` : "1905"}
            value={ui.knownText}
            error={known.error ?? undefined}
            onChange={(e) => setVerifyDraft({ knownText: e.target.value })}
            focusOnMount={Boolean(ui.pick)}
            data-testid="verify-known"
          />
          <div className="w-24">
            <Select
              label="Known unit"
              labelHidden
              value={ui.knownUnit}
              onValueChange={(v) => setVerifyDraft({ knownUnit: v as InputUnit })}
              options={INPUT_UNITS.map((u) => ({ value: u, label: u }))}
            />
          </div>
        </div>
        {result ? <ResultBlock result={result} calibration={calibration} /> : null}
        {ui.pick ? (
          <Button variant="secondary" size="sm" className="self-start" onClick={startVerifyPick}>
            Pick again
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Measured, known, difference and the verdict (AC 3); a polite live region so a new result is announced. */
function ResultBlock({ result, calibration }: { result: VerifyResult; calibration: Calibration }) {
  const rows: [string, string][] = [["Measured", result.measuredText]];
  if (result.knownText !== null) rows.push(["Known", result.knownText]);
  if (result.differenceText !== null && result.percent !== null) rows.push(["Difference", `${result.differenceText} (${formatPercent(result.percent)})`]);
  return (
    <section aria-label="Result" className="rounded-sm border border-border bg-surface-2 p-2" data-testid="verify-result">
      <dl className="num grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 text-ws-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted">{term}</dt>
            <dd className="text-text" data-testid={`verify-row-${term.toLowerCase()}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {/* Review V2: only the verdict is announced (politely), not the whole block on every keystroke. */}
      <div role="status" aria-live="polite">
        {result.matches === true ? (
          <p className="mt-2 flex items-center gap-2 text-ws-sm text-success" data-testid="verify-verdict" data-verdict="matches">
            <CircleCheck size={16} aria-hidden="true" className="shrink-0" />
            <span>Matches the calibration at {precisionText(calibration)}</span>
          </p>
        ) : result.matches === false ? (
          <p className="num mt-2 flex items-center gap-2 text-ws-sm text-warning-text" data-testid="verify-verdict" data-verdict="off">
            <TriangleAlert size={16} aria-hidden="true" className="shrink-0" />
            <span>
              Off by {result.differenceText} ({formatPercent(result.percent!)}): recalibrate if the known distance is right
            </span>
          </p>
        ) : (
          <p className="mt-2 text-ws-sm text-muted">
            <span className="sr-only">Measured {result.measuredText}. </span>
            Type the known distance to compare.
          </p>
        )}
      </div>
    </section>
  );
}

/** "the shown precision (1 mm)" for the verdict. */
function precisionText(c: Pick<Calibration, "unit" | "precision">): string {
  const step =
    c.precision === "1/8" || c.precision === "1/16"
      ? `${c.precision}"`
      : c.unit === "ft-in" || c.unit === "in"
        ? `${c.precision === "0" ? "1" : c.precision.replace(/0$/, "1")}"`
        : `${c.precision === "0" ? "1" : c.precision.replace(/0$/, "1")} ${c.unit}`;
  return `the shown precision (${step})`;
}
