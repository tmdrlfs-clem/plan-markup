import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";

// Placeholder until Story 1.8 replaces it with the workspace shell.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-ad-3xl font-semibold text-text">Plan Markup</h1>
        <Link
          href="/sign-in"
          className="inline-flex h-10 items-center rounded border border-transparent px-4 text-ad-sm font-medium text-text hover:border-border hover:bg-surface-3 focus-ring"
        >
          Sign in
        </Link>
      </div>
      <p className="text-ad-md text-muted">
        Mark up construction plans and check sprinkler layouts in your browser.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
      </div>
      <div className="max-w-sm">
        <TextField
          label="Project name"
          hint="You can change this later."
          placeholder="Level 2 sprinkler plan"
        />
      </div>
    </main>
  );
}
