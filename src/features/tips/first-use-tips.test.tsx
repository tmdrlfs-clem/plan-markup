// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { FirstUseTip, parseTips, tipsStorageKey, tipsStore, useFirstUseTipsPersistence } from "./first-use-tips";

function Host({ userId, tip = true }: { userId: string; tip?: boolean }) {
  useFirstUseTipsPersistence(userId);
  return tip ? <FirstUseTip id="calibrate">Tip text</FirstUseTip> : null;
}

afterEach(() => {
  localStorage.clear();
  tipsStore.setState({ seen: [], loaded: false }, true);
});

describe("first-use tips (UX-DR16)", () => {
  it("shows a tip the first time only, per user, remembered in localStorage; Dismiss hides it", async () => {
    const user = userEvent.setup();
    // The workspace reads the user's record first; the dialog with the tip mounts later.
    const first = render(<Host userId="u1" tip={false} />);
    expect(parseTips(localStorage.getItem(tipsStorageKey("u1")))).toEqual([]);
    first.rerender(<Host userId="u1" />);
    expect(screen.getByRole("note")).toHaveTextContent("Tip text");
    expect(parseTips(localStorage.getItem(tipsStorageKey("u1")))).toEqual(["calibrate"]);
    await user.click(screen.getByRole("button", { name: "Dismiss tip" }));
    expect(screen.queryByRole("note")).toBeNull();
    first.unmount();
    render(<Host userId="u1" />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("another user still gets the tip; broken storage reads as nothing seen", () => {
    localStorage.setItem(tipsStorageKey("u1"), JSON.stringify({ v: 1, seen: ["calibrate"] }));
    expect(parseTips("not json")).toEqual([]);
    expect(parseTips(JSON.stringify({ v: 2, seen: [] }))).toEqual([]);
    const host = render(<Host userId="u2" tip={false} />);
    host.rerender(<Host userId="u2" />);
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
});
