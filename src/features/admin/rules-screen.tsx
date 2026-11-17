import { FIGURE_KEYS, HAZARDS, NZS4541_V1, RULESET_ID, ruleSetOfRow, rulesetLabel, type RuleFiguresRow, type RuleSet } from "@/core/sprinkler/rules/rules";
import type { ResolvedUseMap } from "@/core/sprinkler/use-map";
import { UseMapForm } from "@/features/company/use-map-form";

import { ConfirmVersion } from "./confirm-version";
import { RuleFiguresForm } from "./rule-figures-form";
import { saveDefaultUseMap } from "./rules-actions";

const DATE_FORMAT = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Pacific/Auckland",
});

function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
}

export type VersionStatus = "in use" | "draft" | "earlier" | "replaced draft";

export type RuleVersion = { rules: RuleSet; createdAt: string; verifiedAt: string | null; status: VersionStatus };

/** The versions of the ruleset, newest first, each with what it is now. */
export function versionsOf(rows: readonly RuleFiguresRow[]): RuleVersion[] {
  const versions = rows
    .filter((r) => r.ruleset_id === RULESET_ID)
    .flatMap((r) => {
      const rules = ruleSetOfRow(r);
      return rules ? [{ rules, createdAt: r.created_at ?? "", verifiedAt: r.verified_at ?? null }] : [];
    })
    .sort((a, b) => Number(b.rules.version) - Number(a.rules.version));
  const inUse = versions.find((v) => v.rules.verified)?.rules.version;
  return versions.map((v, i) => ({
    ...v,
    status: v.rules.version === inUse ? "in use" : v.rules.verified ? "earlier" : i === 0 ? "draft" : "replaced draft",
  }));
}

const STATUS_LABELS: Record<VersionStatus, string> = {
  "in use": "In use",
  draft: "Draft",
  earlier: "Earlier",
  "replaced draft": "Draft, replaced",
};

/** What changed from `before` to `after`, as "ELH Amax 21 → 20". */
export function figureChanges(before: RuleSet | undefined, after: RuleSet): string[] {
  if (!before) return [];
  const out: string[] = [];
  for (const h of HAZARDS) {
    for (const k of FIGURE_KEYS) {
      if (before.hazards[h][k] !== after.hazards[h][k]) out.push(`${h} ${k} ${before.hazards[h][k]} → ${after.hazards[h][k]}`);
    }
  }
  return out;
}

const TH = "px-4 py-2.5 font-medium";

const DEFAULT_MAP_SAVED = {
  title: "Default mapping saved (v{version}).",
  description: "It is a draft until you confirm it. New zones use it where a company has no mapping of its own.",
};

export type RulesScreenProps = { figures: RuleFiguresRow[]; mapping: ResolvedUseMap };

/**
 * Story 10.13 (FR79, A7): admin → Rule figures. The platform admin maintains
 * the placement figures (each edit a new version, in use only once confirmed)
 * and the platform default use → hazard mapping.
 */
export function RulesScreen({ figures, mapping }: RulesScreenProps) {
  const versions = versionsOf(figures);
  const newest = versions[0];
  const inUse = versions.find((v) => v.status === "in use");
  const draft = newest?.status === "draft" ? newest : null;
  const start = newest?.rules ?? NZS4541_V1;
  const draftChanges = draft ? figureChanges(inUse?.rules, draft.rules) : [];
  const { map, source } = mapping;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-ad-xl font-semibold">Rule figures</h1>
        <p className="text-ad-sm text-muted">
          The NZS 4541 figures every placement and check uses, and the default hazard class of each use. An edit never changes a version:
          it adds the next one as a draft, and a draft is used by nobody until you confirm it.
        </p>
      </div>

      <section aria-labelledby="rule-figures-heading" className="flex flex-col gap-3">
        <h2 id="rule-figures-heading" className="text-ad-md font-semibold">
          Placement figures
        </h2>
        <p className="text-ad-sm" data-testid="rules-in-use">
          {inUse ? `${rulesetLabel(inUse.rules)} is in use.` : "No version has been confirmed: the app uses its built-in figures (NZS 4541 v1)."}
        </p>
        {draft ? (
          <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface-2 px-4 py-3" data-testid="rules-draft">
            <p className="min-w-0 flex-1 text-ad-sm">
              <span className="font-medium">v{draft.rules.version} is a draft.</span> Nobody uses it yet. Check its figures below against the
              standard, then confirm it to put it in use.
              {inUse && draftChanges.length > 0 ? ` Changed from v${inUse.rules.version}: ${draftChanges.join(", ")}.` : ""}
            </p>
            <ConfirmVersion kind="figures" version={draft.rules.version} />
          </div>
        ) : null}
        {/* Keyed by the newest version: after a save the form starts again from what is stored. */}
        <RuleFiguresForm key={start.version} version={start.version} hazards={start.hazards} />
      </section>

      <section aria-labelledby="rule-versions-heading" className="flex flex-col gap-3">
        <h2 id="rule-versions-heading" className="text-ad-md font-semibold">
          Versions
        </h2>
        <div className="overflow-x-auto rounded border border-border bg-surface-2 shadow-1">
          <table className="w-full min-w-[640px] table-fixed border-collapse">
            <caption className="sr-only">Versions of the placement figures, newest first</caption>
            <colgroup>
              <col className="w-[90px]" />
              <col className="w-[140px]" />
              <col />
              <col className="w-[130px]" />
              <col className="w-[130px]" />
            </colgroup>
            <thead>
              <tr className="bg-surface-1 text-left text-ad-sm text-muted">
                <th scope="col" className={TH}>
                  Version
                </th>
                <th scope="col" className={TH}>
                  Status
                </th>
                <th scope="col" className={TH}>
                  Source and changes
                </th>
                <th scope="col" className={TH}>
                  Added
                </th>
                <th scope="col" className={TH}>
                  Confirmed
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v, i) => {
                const changes = figureChanges(versions[i + 1]?.rules, v.rules);
                return (
                  <tr key={v.rules.version} className="border-t border-border align-top" data-testid="rule-version-row">
                    <th scope="row" className="px-4 py-3 text-left text-ad-sm font-medium tabular-nums">
                      v{v.rules.version}
                    </th>
                    <td className="px-4 py-3 text-ad-sm">{STATUS_LABELS[v.status]}</td>
                    <td className="px-4 py-3 text-ad-sm">
                      <span className="block break-words">{v.rules.source}</span>
                      {changes.length > 0 ? <span className="block break-words text-muted">{changes.join(", ")}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ad-sm text-muted">{day(v.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ad-sm text-muted">{day(v.verifiedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="use-map-heading" className="flex flex-col gap-3">
        <h2 id="use-map-heading" className="text-ad-md font-semibold">
          Default use → hazard class
        </h2>
        <p className="text-ad-sm text-muted">
          What a new zone starts as for everyone whose company has no mapping of its own. Zones already drawn keep their use and hazard
          class, and a company&apos;s own mapping is not touched.
        </p>
        {source === "platform" ? (
          <div className="flex flex-wrap items-center gap-3" data-testid="default-map-status">
            <p className="min-w-0 flex-1 text-ad-sm">
              {map.verified ? `Mapping v${map.version} is verified.` : `Mapping v${map.version} is a draft, not yet verified. It is in use, shown as a draft.`}
            </p>
            {map.verified ? null : <ConfirmVersion kind="mapping" version={map.version} />}
          </div>
        ) : (
          <p className="text-ad-sm" data-testid="default-map-status">
            The database holds no default mapping: the app uses its built-in one. Saving stores it.
          </p>
        )}
        <UseMapForm
          key={`${source}-${map.version}`}
          source={source}
          defaultUse={map.defaultUse}
          uses={map.uses}
          save={saveDefaultUseMap}
          saved={DEFAULT_MAP_SAVED}
        />
      </section>
    </div>
  );
}
