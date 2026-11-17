"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { toast } from "@/components/ui/toast-store";
import { HAZARDS, type Hazard } from "@/core/sprinkler/rules/rules";
import { MAX_COMPANY_USES, USE_NAME_HINT, companyUseMapSchema, type MappingSource } from "@/core/sprinkler/use-map";

import { resetCompanyUseMap, saveCompanyUseMap } from "./use-map-actions";

const noSubscription = () => () => {};

export const HAZARD_NAMES: Record<Hazard, string> = {
  ELH: "ELH · Extra light hazard",
  OH1: "OH1 · Ordinary hazard 1",
  OH2: "OH2 · Ordinary hazard 2",
  OH3: "OH3 · Ordinary hazard 3",
};

type Row = { key: number; use: string; hazard: Hazard };

export type UseMapFormProps = {
  /** Where the shown mapping comes from: the company's own, or the default it would start from. */
  source: MappingSource;
  defaultUse: string;
  uses: { use: string; hazard: Hazard }[];
};

const CONTROL = "h-10 w-full rounded border bg-surface-2 px-3 text-ad-sm text-text focus-ring";
const TH = "px-4 py-2.5 font-medium";

/** Story 10.12: the company's use → hazard mapping as an editable table, saved as a whole. */
export function UseMapForm({ source, defaultUse, uses }: UseMapFormProps) {
  const router = useRouter();
  const nextKey = useRef(uses.length);
  const tableRef = useRef<HTMLTableElement>(null);
  const [rows, setRows] = useState<Row[]>(() => uses.map((u, key) => ({ key, ...u })));
  const [chosen, setChosen] = useState<number | null>(() => {
    const at = uses.findIndex((u) => u.use === defaultUse);
    return at < 0 ? null : at;
  });
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, startTransition] = useTransition();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const disabled = pending || !hydrated;

  function update(key: number, change: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...change } : r)));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function add() {
    const key = nextKey.current++;
    setRows((current) => [...current, { key, use: "", hazard: "OH1" }]);
    // The new row's name takes the focus once it is drawn.
    requestAnimationFrame(() => tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${key}"]`)?.focus());
  }

  function remove(key: number) {
    setRows((current) => current.filter((r) => r.key !== key));
    if (chosen === key) setChosen(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    const input = {
      defaultUse: (rows.find((r) => r.key === chosen)?.use ?? "").trim(),
      uses: rows.map((r) => ({ use: r.use, hazard: r.hazard })),
    };
    const parsed = companyUseMapSchema.safeParse(input);
    if (!parsed.success) {
      const byRow: Record<number, string> = {};
      let other: string | null = null;
      for (const issue of parsed.error.issues) {
        const row = issue.path[0] === "uses" && typeof issue.path[1] === "number" ? rows[issue.path[1]] : undefined;
        if (row) byRow[row.key] ??= issue.message;
        else other ??= issue.message;
      }
      setErrors(byRow);
      setFormError(other);
      const first = rows.find((r) => r.key in byRow);
      if (first) tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${first.key}"]`)?.focus();
      return;
    }
    startTransition(async () => {
      const result = await saveCompanyUseMap(input);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      toast(
        result.data.changed
          ? { variant: "success", title: `Mapping saved (v${result.data.version}).`, description: "New zones use it. Zones already drawn keep their use and hazard class." }
          : { variant: "info", title: "Nothing changed: the mapping already was like this." },
      );
      router.refresh();
    });
  }

  function reset() {
    startTransition(async () => {
      const result = await resetCompanyUseMap();
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      toast({ variant: "success", title: "Your company uses the platform default mapping again." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="use-map-heading" className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded border border-border bg-surface-2 shadow-1">
        <table ref={tableRef} className="w-full min-w-[640px] table-fixed border-collapse">
          <caption className="sr-only">Uses and their default hazard class</caption>
          <colgroup>
            <col />
            <col className="w-[260px]" />
            <col className="w-[110px]" />
            <col className="w-[120px]" />
          </colgroup>
          <thead>
            <tr className="bg-surface-1 text-left text-ad-sm text-muted">
              <th scope="col" className={TH}>
                Use
              </th>
              <th scope="col" className={TH}>
                Hazard class
              </th>
              <th scope="col" className={TH}>
                Default
              </th>
              <th scope="col" className={TH}>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const name = row.use.trim() === "" ? `use ${index + 1}` : row.use.trim();
              const error = errors[row.key];
              return (
                <tr key={row.key} className="border-t border-border align-top" data-testid="use-row">
                  <td className="px-4 py-2">
                    <input
                      data-row={row.key}
                      aria-label={`Name of use ${index + 1}`}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `use-error-${row.key}` : undefined}
                      value={row.use}
                      maxLength={40}
                      readOnly={pending}
                      autoComplete="off"
                      onChange={(event) => update(row.key, { use: event.target.value })}
                      className={cx(CONTROL, error ? "border-danger" : "border-strong")}
                    />
                    {error ? (
                      <p id={`use-error-${row.key}`} className="mt-1 text-ad-sm font-medium text-danger">
                        {error}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      aria-label={`Hazard class of ${name}`}
                      value={row.hazard}
                      disabled={disabled}
                      onChange={(event) => update(row.key, { hazard: event.target.value as Hazard })}
                      className={cx(CONTROL, "border-strong disabled:cursor-not-allowed disabled:opacity-60")}
                    >
                      {HAZARDS.map((hazard) => (
                        <option key={hazard} value={hazard}>
                          {HAZARD_NAMES[hazard]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <label className="flex h-10 items-center gap-2 text-ad-sm">
                      <input
                        type="radio"
                        name="default-use"
                        aria-label={`${name} is the default use`}
                        checked={chosen === row.key}
                        disabled={disabled}
                        onChange={() => setChosen(row.key)}
                        className="h-4 w-4 accent-[var(--color-accent)] focus-ring"
                      />
                      <span aria-hidden="true">{chosen === row.key ? "Default" : ""}</span>
                    </label>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      disabled={disabled || rows.length === 1}
                      aria-label={`Remove ${name}`}
                      onClick={() => remove(row.key)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-ad-sm text-muted">Use names: {USE_NAME_HINT}</p>
      {formError ? (
        <p role="alert" className="text-ad-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="md" disabled={disabled || rows.length >= MAX_COMPANY_USES} onClick={add}>
          Add a use
        </Button>
        <Button type="submit" variant="primary" size="md" disabled={disabled}>
          {pending ? "Saving…" : "Save mapping"}
        </Button>
        {source === "company" ? (
          <Button type="button" variant="destructive" size="md" disabled={disabled} className="ml-auto" onClick={() => setConfirmReset(true)}>
            Use the platform default
          </Button>
        ) : null}
      </div>
      <AlertDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Go back to the platform default?"
        description="Your company's own mapping is removed and new zones follow the platform default mapping. Zones already drawn keep their use and hazard class."
        actionLabel="Use the platform default"
        destructive
        onAction={() => {
          setConfirmReset(false);
          reset();
        }}
      />
    </form>
  );
}
