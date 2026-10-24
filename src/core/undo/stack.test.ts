import { describe, expect, it } from "vitest";

import { EMPTY_HISTORY, execute, nextLabels, redo, undo, type UndoCommand } from "./stack";

function counter() {
  const state = { value: 0 };
  const add = (n: number): UndoCommand => ({
    label: `Add ${n}`,
    do: () => {
      state.value += n;
    },
    undo: () => {
      state.value -= n;
    },
  });
  return { state, add };
}

describe("undo stack (Story 4.3 AC 7)", () => {
  it("executes, undoes and redoes command objects in order", () => {
    const { state, add } = counter();
    let h = execute(EMPTY_HISTORY, add(1));
    h = execute(h, add(10));
    expect(state.value).toBe(11);
    expect(nextLabels(h)).toEqual({ undo: "Add 10", redo: null });
    h = undo(h);
    expect(state.value).toBe(1);
    expect(nextLabels(h)).toEqual({ undo: "Add 1", redo: "Add 10" });
    h = redo(h);
    expect(state.value).toBe(11);
    h = undo(undo(h));
    expect(state.value).toBe(0);
    expect(undo(h)).toBe(h); // nothing left: unchanged
  });

  it("a new step clears the redo steps; the oldest steps drop past the limit", () => {
    const { state, add } = counter();
    let h = execute(execute(EMPTY_HISTORY, add(1)), add(2));
    h = undo(h);
    h = execute(h, add(5));
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
    expect(state.value).toBe(6);
    let limited = EMPTY_HISTORY;
    for (let i = 0; i < 5; i++) limited = execute(limited, add(1), 3);
    expect(limited.past).toHaveLength(3);
  });
});
