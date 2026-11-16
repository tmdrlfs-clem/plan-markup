// Story 10.8: the plan recorded on companies and individual accounts (FR13).
// A record only: nothing is switched on or off by it before billing exists.

export type Plan = "trial" | "pilot" | "standard";

export const PLANS: readonly Plan[] = ["trial", "pilot", "standard"];

export const PLAN_LABELS: Record<Plan, string> = { trial: "Trial", pilot: "Pilot", standard: "Standard" };

/**
 * The plan someone works under, as they are shown it: their company's when
 * they are in one, otherwise the account's own.
 */
export type EffectivePlan = { plan: Plan; companyName: string | null };

export function effectivePlan(ownPlan: Plan, company: { plan: Plan; name: string } | null): EffectivePlan {
  return company ? { plan: company.plan, companyName: company.name } : { plan: ownPlan, companyName: null };
}

/** "Pilot plan", or "Standard plan, through Acme Fire" for a company member. */
export function planSentence({ plan, companyName }: EffectivePlan): string {
  return companyName ? `${PLAN_LABELS[plan]} plan, through ${companyName}` : `${PLAN_LABELS[plan]} plan`;
}

/** A stored value as a Plan; anything unknown reads as the default. */
export function asPlan(value: unknown): Plan {
  return (PLANS as readonly unknown[]).includes(value) ? (value as Plan) : "trial";
}
