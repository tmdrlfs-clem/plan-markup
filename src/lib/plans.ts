// Story 10.8: the plan recorded on companies and individual accounts (FR13).
// A record only: nothing is switched on or off by it before billing exists.

export type Plan = "trial" | "pilot" | "standard";

export const PLANS: readonly Plan[] = ["trial", "pilot", "standard"];

export const PLAN_LABELS: Record<Plan, string> = { trial: "Trial", pilot: "Pilot", standard: "Standard" };

/** A stored value as a Plan; anything unknown reads as the default. */
export function asPlan(value: unknown): Plan {
  return (PLANS as readonly unknown[]).includes(value) ? (value as Plan) : "trial";
}
