import { beforeEach, describe, expect, it } from "vitest";

import { dismiss, resetToasts, toast, toastStore } from "./toast-store";

const state = () => toastStore.getState();

describe("toast store", () => {
  beforeEach(resetToasts);

  it("adds a toast with defaults", () => {
    const id = toast({ title: "Saved" });
    expect(state().visible).toHaveLength(1);
    expect(state().visible[0]).toMatchObject({ id, title: "Saved", variant: "neutral", count: 1 });
  });

  it("keeps newest last", () => {
    toast({ title: "One" });
    toast({ title: "Two" });
    expect(state().visible.map((t) => t.title)).toEqual(["One", "Two"]);
  });

  it("merges identical toasts, bumping count and the restart token", () => {
    const first = toast({ title: "Saved", variant: "success", description: "Plan A" });
    const second = toast({ title: "Saved", variant: "success", description: "Plan A" });
    expect(second).toBe(first);
    expect(state().visible).toHaveLength(1);
    expect(state().visible[0]).toMatchObject({ count: 2, restart: 1 });
    toast({ title: "Saved", variant: "success", description: "Plan A" });
    expect(state().visible[0]).toMatchObject({ count: 3, restart: 2 });
  });

  it("does not merge toasts that differ in variant, title or description", () => {
    toast({ title: "Saved", variant: "success" });
    toast({ title: "Saved", variant: "info" });
    toast({ title: "Saved too", variant: "success" });
    toast({ title: "Saved", variant: "success", description: "x" });
    expect(state().visible).toHaveLength(3);
    expect(state().queue).toHaveLength(1);
  });

  it("shows at most 3 and queues the rest first-in first-out", () => {
    for (const title of ["A", "B", "C", "D", "E"]) toast({ title });
    expect(state().visible.map((t) => t.title)).toEqual(["A", "B", "C"]);
    expect(state().queue.map((t) => t.title)).toEqual(["D", "E"]);
    dismiss(state().visible[1].id);
    expect(state().visible.map((t) => t.title)).toEqual(["A", "C", "D"]);
    expect(state().queue.map((t) => t.title)).toEqual(["E"]);
    dismiss(state().visible[0].id);
    expect(state().visible.map((t) => t.title)).toEqual(["C", "D", "E"]);
    expect(state().queue).toEqual([]);
  });

  it("merges into a queued duplicate", () => {
    for (const title of ["A", "B", "C", "D"]) toast({ title });
    toast({ title: "D" });
    expect(state().queue).toHaveLength(1);
    expect(state().queue[0].count).toBe(2);
  });

  it("dismisses queued toasts by id and ignores unknown ids", () => {
    for (const title of ["A", "B", "C", "D"]) toast({ title });
    dismiss(state().queue[0].id);
    expect(state().queue).toEqual([]);
    dismiss("nope");
    expect(state().visible).toHaveLength(3);
  });

  it("keeps the action", () => {
    const onAction = () => {};
    toast({ title: "Deleted", action: { label: "Undo", onAction } });
    expect(state().visible[0].action).toEqual({ label: "Undo", onAction });
  });
});
