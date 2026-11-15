"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast-store";
import { createCompany, type CreateCompanyField } from "./company-actions";

const noSubscription = () => () => {};

/** Story 10.5: a company's name and the email of its first admin (an existing, active account). */
export function CreateCompanyForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Partial<Record<CreateCompanyField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Until React has taken over the page a submit would be a plain form post.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = { name: String(form.get("name") ?? ""), adminEmail: String(form.get("adminEmail") ?? "") };
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await createCompany(input);
      if (!result.ok) {
        if (result.field) {
          setErrors({ [result.field]: result.message });
          formRef.current?.querySelector<HTMLInputElement>(`[name="${result.field}"]`)?.focus();
        } else {
          setFormError(result.message);
        }
        return;
      }
      formRef.current?.reset();
      toast({ variant: "success", title: `${result.data.name} is created.` });
      router.refresh();
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-labelledby="new-company-heading"
      className="flex flex-col gap-4 rounded border border-border bg-surface-2 p-5 shadow-1"
    >
      <div className="flex flex-col gap-1">
        <h2 id="new-company-heading" className="text-ad-md font-semibold">
          New company
        </h2>
        <p className="text-ad-sm text-muted">
          The first admin must already have an active account and belong to no company. They will invite the rest of their team.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Company name" name="name" maxLength={100} autoComplete="off" error={errors.name} readOnly={pending} />
        <TextField
          label="First admin's email"
          name="adminEmail"
          type="email"
          maxLength={254}
          autoComplete="off"
          error={errors.adminEmail}
          // Read-only, not disabled, while saving: a refusal moves focus to its field.
          readOnly={pending}
        />
      </div>
      {formError ? (
        <p role="alert" className="text-ad-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" size="md" disabled={pending || !hydrated}>
          {pending ? "Creating…" : "Create company"}
        </Button>
      </div>
    </form>
  );
}
