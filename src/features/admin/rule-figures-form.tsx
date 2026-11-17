"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { toast } from "@/components/ui/toast-store";
import { FIGURES, FIGURE_KEYS, HAZARDS, ruleFiguresInputSchema, type FigureKey, type Hazard, type HazardRule } from "@/core/sprinkler/rules/rules";

import { saveRuleFigures } from "./rules-actions";

const noSubscription = () => () => {};

export type RuleFiguresFormProps = {
  /** The newest version: the form starts from its figures. */
  version: string;
  hazards: Record<Hazard, HazardRule>;
};

type Cells = Record<string, string>;
const cellKey = (hazard: Hazard, key: FigureKey) => `${hazard}.${key}`;

const CONTROL = "h-10 w-full rounded border bg-surface-2 px-3 text-right text-ad-sm tabular-nums text-text focus-ring";
const TH = "px-4 py-2.5 font-medium";
/** An error on the page background: the danger red needs a light backing to be readable (WCAG AA). */
const ERROR_BOX = "rounded border border-danger bg-surface-2 px-3 py-2 text-ad-sm font-medium text-danger";

/** A typed figure as a number; NaN when it is not one ("4,6" reads as 4.6). */
export function parseFigure(text: string): number {
  const t = text.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/**
 * Story 10.13: the placement figures of the four hazard classes as an editable
 * table. Saving adds the next version as a draft; nothing in use changes.
 */
export function RuleFiguresForm({ version, hazards }: RuleFiguresFormProps) {
  const router = useRouter();
  const tableRef = useRef<HTMLTableElement>(null);
  const [cells, setCells] = useState<Cells>(() => {
    const start: Cells = {};
    for (const h of HAZARDS) for (const k of FIGURE_KEYS) start[cellKey(h, k)] = String(hazards[h][k]);
    return start;
  });
  const [source, setSource] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const disabled = pending || !hydrated;

  function clearError(key: string) {
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function update(key: string, value: string) {
    setCells((current) => ({ ...current, [key]: value }));
    clearError(key);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    const input = {
      hazards: Object.fromEntries(HAZARDS.map((h) => [h, Object.fromEntries(FIGURE_KEYS.map((k) => [k, parseFigure(cells[cellKey(h, k)])]))])),
      source,
    };
    const parsed = ruleFiguresInputSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === "hazards" && issue.path.length === 3 ? `${String(issue.path[1])}.${String(issue.path[2])}` : String(issue.path[0]);
        next[key] ??= issue.message;
      }
      setErrors(next);
      const first = Object.keys(next)[0];
      if (first) (first === "source" ? document.getElementById("rule-figures-source") : tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${first}"]`))?.focus();
      return;
    }
    startTransition(async () => {
      const result = await saveRuleFigures(parsed.data);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      toast(
        result.data.changed
          ? { variant: "success", title: `Saved as v${result.data.version}, a draft.`, description: "Nobody uses it until you confirm it." }
          : { variant: "info", title: `Nothing changed: these are the figures of v${result.data.version}.` },
      );
      router.refresh();
    });
  }

  const cellErrors = Object.entries(errors).filter(([key]) => key !== "source");

  return (
    <form onSubmit={submit} noValidate aria-labelledby="rule-figures-heading" className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded border border-border bg-surface-2 shadow-1">
        <table ref={tableRef} className="w-full min-w-[780px] table-fixed border-collapse">
          <caption className="sr-only">Placement figures per hazard class, starting from v{version}</caption>
          <colgroup>
            <col className="w-[270px]" />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className="bg-surface-1 text-left text-ad-sm text-muted">
              <th scope="col" className={TH}>
                Figure
              </th>
              {HAZARDS.map((h) => (
                <th key={h} scope="col" className={cx(TH, "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FIGURE_KEYS.map((k) => (
              <tr key={k} className="border-t border-border align-top" data-testid={`figure-row-${k}`}>
                <th scope="row" className="px-4 py-2 text-left text-ad-sm font-normal">
                  <span className="flex h-10 items-center gap-1 whitespace-nowrap">
                    {FIGURES[k].label}
                    <span className="font-mono text-muted">
                      ({k}, {FIGURES[k].unit})
                    </span>
                  </span>
                </th>
                {HAZARDS.map((h) => {
                  const key = cellKey(h, k);
                  const error = errors[key];
                  return (
                    <td key={h} className="px-2 py-2">
                      <input
                        data-cell={key}
                        inputMode="decimal"
                        aria-label={`${FIGURES[k].label} of ${h}, in ${FIGURES[k].unit === "m" ? "metres" : "square metres"}`}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? "rule-figures-errors" : undefined}
                        value={cells[key]}
                        maxLength={12}
                        readOnly={pending}
                        autoComplete="off"
                        onChange={(event) => update(key, event.target.value)}
                        className={cx(CONTROL, error ? "border-danger" : "border-strong")}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cellErrors.length > 0 ? (
        <div id="rule-figures-errors" role="alert" className={ERROR_BOX}>
          <ul className="flex flex-col gap-1">
            {cellErrors.map(([key, message]) => {
              const [hazard, figure] = key.split(".") as [Hazard, FigureKey];
              return (
                <li key={key}>
                  {hazard} {FIGURES[figure]?.label.toLowerCase() ?? figure}: {message}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="rule-figures-source" className="text-ad-sm font-medium">
          Source of the change
        </label>
        <textarea
          id="rule-figures-source"
          rows={2}
          maxLength={500}
          value={source}
          readOnly={pending}
          aria-invalid={errors.source ? true : undefined}
          aria-describedby={errors.source ? "rule-figures-source-error" : "rule-figures-source-hint"}
          onChange={(event) => {
            setSource(event.target.value);
            clearError("source");
          }}
          className={cx("w-full rounded border bg-surface-2 px-3 py-2 text-ad-sm text-text focus-ring", errors.source ? "border-danger" : "border-strong")}
        />
        {errors.source ? (
          <p id="rule-figures-source-error" className={ERROR_BOX}>
            {errors.source}
          </p>
        ) : (
          <p id="rule-figures-source-hint" className="text-ad-sm text-muted">
            The clause or table of the standard, and why the figures change. It is kept with the version.
          </p>
        )}
      </div>
      {formError ? (
        <p role="alert" className={ERROR_BOX}>
          {formError}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" size="md" disabled={disabled}>
          {pending ? "Saving…" : "Save as a new version"}
        </Button>
      </div>
    </form>
  );
}
