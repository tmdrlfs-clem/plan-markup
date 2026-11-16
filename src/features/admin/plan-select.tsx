"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore, useTransition } from "react";

import { toast } from "@/components/ui/toast-store";
import { PLAN_LABELS, PLANS, type Plan } from "@/lib/plans";
import { setPlan } from "./plan-actions";

const noSubscription = () => () => {};

export type PlanSelectProps = {
  targetType: "user" | "company";
  targetId: string;
  /** The account's or company's name: said in the toast and to screen readers. */
  label: string;
  plan: Plan;
};

/** Story 10.8: the plan of one account or company; a change is saved at once. */
export function PlanSelect({ targetType, targetId, label, plan }: PlanSelectProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  return (
    <select
      aria-label={`Plan of ${label}`}
      value={plan}
      disabled={pending || !hydrated}
      onChange={(event) => {
        const next = event.target.value as Plan;
        if (next === plan) return;
        startTransition(async () => {
          const result = await setPlan({ targetType, targetId, plan: next });
          toast(
            result.ok
              ? { variant: "success", title: `${label} is on the ${PLAN_LABELS[next]} plan.` }
              : { variant: "danger", title: result.message },
          );
          router.refresh();
        });
      }}
      className="h-10 w-full rounded border border-strong bg-surface-2 px-2 text-ad-sm text-text focus-ring disabled:cursor-not-allowed disabled:opacity-60"
    >
      {PLANS.map((value) => (
        <option key={value} value={value}>
          {PLAN_LABELS[value]}
        </option>
      ))}
    </select>
  );
}
