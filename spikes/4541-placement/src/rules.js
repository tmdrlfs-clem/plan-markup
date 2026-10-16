// Rule set nzs4541 v1 as data (figures in metres / square metres).
// Placement figures founder-confirmed 2026-10-16. Extra named tables (e.g. a future
// `obstructions` table) carry their own `verified` flag (design §9.5 hook).

export const NZS4541_V1 = {
  id: 'nzs4541',
  version: '1',
  verified: true,
  source: 'Placement figures founder-confirmed against NZS 4541, 2026-10-16',
  units: 'm',
  hazards: {
    ELH: { Amax: 21, Smax: 4.6, Smin: 1.8, Wmax: 2.3, WmaxReduced: 1.5, Wmin: 0.05 },
    OH1: { Amax: 12, Smax: 4.0, Smin: 1.8, Wmax: 2.0, WmaxReduced: 1.5, Wmin: 0.05 },
    OH2: { Amax: 12, Smax: 4.0, Smin: 1.8, Wmax: 2.0, WmaxReduced: 1.5, Wmin: 0.05 },
    OH3: { Amax: 12, Smax: 4.0, Smin: 1.8, Wmax: 2.0, WmaxReduced: 1.5, Wmin: 0.05 },
  },
  tables: {},
};

export const HAZARDS = ['ELH', 'OH1', 'OH2', 'OH3'];

// Validates a rule set the way the production Zod schema would (Smin < Smax, Wmin < Wmax, all > 0).
export function validateRuleSet(rs) {
  const problems = [];
  for (const h of Object.keys(rs.hazards)) {
    const f = rs.hazards[h];
    for (const k of ['Amax', 'Smax', 'Smin', 'Wmax', 'Wmin']) if (!(f[k] > 0)) problems.push(`${h}.${k} must be > 0`);
    if (!(f.Smin < f.Smax)) problems.push(`${h}: Smin must be < Smax`);
    if (!(f.Wmin < f.Wmax)) problems.push(`${h}: Wmin must be < Wmax`);
  }
  return problems;
}
