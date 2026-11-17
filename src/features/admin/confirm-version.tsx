"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-store";

import { confirmDefaultUseMap, confirmRuleFigures } from "./rules-actions";

const noSubscription = () => () => {};

const COPY = {
  figures: {
    button: (v: string) => `Confirm v${v}`,
    title: (v: string) => `Put v${v} in use?`,
    description: (v: string) =>
      `You have checked the figures of v${v} against the standard. From now on every new placement and every check uses them. Heads already placed stay where they are, marked with the version they were placed with. This cannot be undone: a correction is a new version.`,
    done: (v: string) => `v${v} is in use.`,
    already: (v: string) => `v${v} was already confirmed.`,
  },
  mapping: {
    button: (v: string) => `Confirm mapping v${v}`,
    title: (v: string) => `Mark mapping v${v} as verified?`,
    description: (v: string) =>
      `You have checked the default mapping v${v}. It stops being shown as a draft. The mapping itself and the zones already drawn do not change.`,
    done: (v: string) => `Mapping v${v} is verified.`,
    already: (v: string) => `Mapping v${v} was already verified.`,
  },
} as const;

/** Story 10.13: the platform admin's own confirmation of a draft (asked first; audited). */
export function ConfirmVersion({ kind, version }: { kind: keyof typeof COPY; version: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const copy = COPY[kind];

  function confirm() {
    startTransition(async () => {
      const result = await (kind === "figures" ? confirmRuleFigures : confirmDefaultUseMap)({ version });
      toast(
        result.ok
          ? { variant: result.data.changed ? "success" : "info", title: result.data.changed ? copy.done(version) : copy.already(version) }
          : { variant: "danger", title: result.message },
      );
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="primary" size="md" disabled={pending || !hydrated} onClick={() => setOpen(true)}>
        {pending ? "Confirming…" : copy.button(version)}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={setOpen}
        title={copy.title(version)}
        description={copy.description(version)}
        actionLabel={copy.button(version)}
        onAction={() => {
          setOpen(false);
          confirm();
        }}
      />
    </>
  );
}
