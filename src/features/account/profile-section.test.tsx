// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ updateName: vi.fn(), changeEmail: vi.fn(), refresh: vi.fn() }));
vi.mock("./profile-actions", () => ({ updateName: m.updateName, changeEmail: m.changeEmail }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));

import { EMAIL_SENT, ProfileSection } from "./profile-section";

beforeEach(() => vi.clearAllMocks());

describe("ProfileSection", () => {
  it("saves a changed name and refreshes the workspace (the markup author)", async () => {
    m.updateName.mockResolvedValue({ ok: true, data: { name: "Pat" } });
    render(<ProfileSection name="Me" email="me@plan-markup.test" />);
    const save = screen.getByRole("button", { name: "Save name" });
    expect(save).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Pat");
    await userEvent.click(save);
    expect(m.updateName).toHaveBeenCalledWith({ name: "Pat" });
    expect(await screen.findByRole("status")).toHaveTextContent("Name saved.");
    expect(m.refresh).toHaveBeenCalled();
  });

  it("starts an email change and says links went to both addresses", async () => {
    m.changeEmail.mockResolvedValue({ ok: true, data: { email: "new@plan-markup.test" } });
    render(<ProfileSection name="Me" email="me@plan-markup.test" />);
    expect(screen.getByTestId("profile-email")).toHaveTextContent("me@plan-markup.test");
    await userEvent.click(screen.getByRole("button", { name: "Change email…" }));
    await userEvent.type(screen.getByLabelText("Email"), "new@plan-markup.test");
    await userEvent.click(screen.getByRole("button", { name: "Send links" }));
    expect(m.changeEmail).toHaveBeenCalledWith({ email: "new@plan-markup.test" });
    expect(await screen.findByRole("status")).toHaveTextContent(EMAIL_SENT("new@plan-markup.test"));
    // The shown email stays the current one until both links are opened.
    expect(screen.getByTestId("profile-email")).toHaveTextContent("me@plan-markup.test");
  });

  it("shows a refused change as an alert", async () => {
    m.changeEmail.mockResolvedValue({ ok: false, code: "INVALID_INPUT", message: "That is already your email." });
    render(<ProfileSection name="Me" email="me@plan-markup.test" />);
    await userEvent.click(screen.getByRole("button", { name: "Change email…" }));
    await userEvent.type(screen.getByLabelText("Email"), "me@plan-markup.test");
    await userEvent.click(screen.getByRole("button", { name: "Send links" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That is already your email.");
  });
});
