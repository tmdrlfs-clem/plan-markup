/**
 * Story 9.11 (FR77, UX-DR24, UX-DR26): what a zone's oracle report says, in
 * the words the 4541 panel and the canvas markers use. Framework-free; lengths
 * in the report's flags are mm, areas m².
 */
import type { Flag, OracleReport } from "./oracle";

/** Story 9.12 (FR78): the advisory notice (the 4541 panel's footer; optionally drawn onto exported pages). */
export const ADVISORY_NOTICE = "Sprinkler layout is advisory. The designer remains responsible for compliance with NZS 4541.";

/** Metres with at most two decimals, trailing zeros dropped ("4.8 m", "4.65 m"). */
export function metres(mm: number): string {
  return Number.isFinite(mm) ? `${Number((mm / 1000).toFixed(2))} m` : "∞";
}

const m2 = (v: number) => `${Number(v.toFixed(2))} m²`;

/** A rule break's short label for its canvas marker and its row ("Spacing 4.8 m > 4.6 m"). */
export function flagLabel(f: Flag): string {
  const v = f.value;
  const l = f.limit;
  switch (f.code) {
    case "MAX_SPACING":
      return v !== undefined && l !== undefined ? `Spacing ${metres(v)} > ${metres(l)}` : "Spacing too wide";
    case "MIN_SPACING":
      return v !== undefined && l !== undefined ? `Spacing ${metres(v)} < ${metres(l)}` : "Heads too close";
    case "WALL_CLEARANCE":
      return v !== undefined && l !== undefined ? `Wall ${metres(v)} < ${metres(l)}` : "Too close to wall";
    case "WALL_DIST":
      return v !== undefined && l !== undefined && Number.isFinite(v) ? `Wall ${metres(v)} > ${metres(l)}` : "Wall not reached";
    case "UNCOVERED":
      return v !== undefined ? `Uncovered ${m2(v)}` : "Uncovered";
    case "AREA_ZONE":
      return v !== undefined && l !== undefined ? `${m2(v)}/head > ${m2(l)}` : "Area per head";
    case "AREA_LOCAL":
      return v !== undefined && l !== undefined ? `Cell ${m2(v)} > ${m2(l)}` : "Head's area";
    case "OUTSIDE":
      return "Outside zone";
    case "IN_KEEPOUT":
      return "In keep-out";
    case "NO_HEADS":
      return "No heads";
    case "RULES_UNVERIFIED":
      return "Rules unverified";
  }
}

export type ZoneStatus =
  | { kind: "pass"; count: 0; text: string }
  | { kind: "warning" | "error"; count: number; text: string }
  | { kind: "infeasible"; count: 0; text: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A zone's status in the zone list: infeasible (the engine could not place it), its errors (✕ n),
 * its warnings (⚠ n) or ✓; null with no report (no heads yet) and not infeasible.
 */
export function zoneStatus(report: OracleReport | null, infeasible = false): ZoneStatus | null {
  if (infeasible) return { kind: "infeasible", count: 0, text: "Infeasible" };
  if (!report) return null;
  if (report.errors > 0) return { kind: "error", count: report.errors, text: `${plural(report.errors, "rule break")}${report.warnings ? `, ${plural(report.warnings, "warning")}` : ""}` };
  if (report.warnings > 0) return { kind: "warning", count: report.warnings, text: plural(report.warnings, "warning") };
  return { kind: "pass", count: 0, text: "Checks pass" };
}

export type ReportRow = { key: string; label: string; value: string; ok: boolean };

/** The ZoneReport's figures: hazard, ruleset version, heads, area per head, spacing and wall distances against their limits. */
export function reportRows(report: OracleReport, hazard: string): ReportRow[] {
  const f = report.figures; // mm, mm²
  const amax = f.Amax / 1e6;
  const rs = report.ruleSet;
  const rows: ReportRow[] = [
    { key: "hazard", label: "Hazard", value: hazard, ok: true },
    { key: "ruleset", label: "Ruleset", value: rs ? `${rs.id} v${rs.version}${rs.verified ? "" : " (unverified)"}` : "None", ok: !!rs?.verified },
    { key: "heads", label: "Heads", value: String(report.headCount), ok: report.headCount > 0 },
    {
      key: "areaPerHead",
      label: "Area per head",
      value: report.headCount ? `${m2(report.areaPerHeadM2)} (max ${m2(amax)})` : "—",
      ok: report.headCount > 0 && report.areaPerHeadM2 <= amax + 1e-9,
    },
    {
      key: "maxSpacing",
      // "Nearest head", not "Max spacing": the figure is the widest nearest-visible-peer distance (oracle C4),
      // which does not see rows that are too far apart (M2 review F1).
      label: "Nearest head",
      value: report.maxNNSpacingM === null ? "—" : `${metres(report.maxNNSpacingM * 1000)} (max ${metres(f.Smax)})`,
      ok: report.maxNNSpacingM === null || report.maxNNSpacingM * 1000 <= f.Smax + 1e-6,
    },
    {
      key: "minWall",
      label: "Min wall distance",
      value: report.minWallDistM === null ? "—" : `${metres(report.minWallDistM * 1000)} (min ${metres(f.Wmin)})`,
      ok: report.minWallDistM === null || report.minWallDistM * 1000 >= f.Wmin - 1e-6,
    },
    {
      key: "maxWall",
      label: "Max wall distance",
      value: Number.isFinite(report.worstWallDistM) ? `${metres(report.worstWallDistM * 1000)} (max ${metres(f.Wmax)})` : "Not reached",
      ok: Number.isFinite(report.worstWallDistM) && report.worstWallDistM * 1000 <= f.Wmax + 1e-6,
    },
  ];
  return rows;
}

/** The report's rule breaks in list order: errors first, then warnings, each with its index in `flags` (the marker's id). */
export function ruleBreaks(report: OracleReport): { index: number; flag: Flag; label: string }[] {
  return report.flags
    .map((flag, index) => ({ index, flag, label: flagLabel(flag) }))
    .sort((a, b) => (a.flag.severity === b.flag.severity ? a.index - b.index : a.flag.severity === "error" ? -1 : 1));
}
