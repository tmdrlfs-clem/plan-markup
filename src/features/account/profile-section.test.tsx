// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ updateName: vi.fn(), changeEmail: vi.fn(), changePassword: vi.fn(), refresh: vi.fn() }));
vi.mock("./profile-actions", () => ({ updateName: m.updateName, changeEmail: m.changeEmail }));
vi.mock("./password-change-actions", () => ({ changePassword: m.changePassword }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));

import { PASSWORD_CHANGE_MESSAGES } from "./password-change-messages";
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

  it("shows the plan the user works under, with nothing to change it (Story 10.8)", () => {
    const { rerender } = render(<ProfileSection name="Me" email="me@plan-markup.test" plan={{ plan: "pilot", companyName: null }} />);
    expect(screen.getByTestId("profile-plan")).toHaveTextContent(/^Pilot$/);
    expect(screen.queryByRole("combobox")).toBeNull();
    rerender(<ProfileSection name="Me" email="me@plan-markup.test" plan={{ plan: "standard", companyName: "Acme Fire" }} />);
    expect(screen.getByTestId("profile-plan")).toHaveTextContent("Standard (the plan of Acme Fire)");
    rerender(<ProfileSection name="Me" email="me@plan-markup.test" />);
    expect(screen.queryByTestId("profile-plan")).toBeNull();
  });

  it("changes the password with the current one, then closes the form", async () => {
    m.changePassword.mockResolvedValue({ ok: true, data: null });
    render(<ProfileSection name="Me" email="me@plan-markup.test" />);
    await userEvent.click(screen.getByRole("button", { name: "Change password…" }));
    const submit = screen.getByRole("button", { name: "Change password" });
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("Current password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("New password")).toHaveAttribute("autocomplete", "new-password");
    await userEvent.type(screen.getByLabelText("Current password"), "old-password-123");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-456");
    await userEvent.click(submit);
    expect(m.changePassword).toHaveBeenCalledWith({ current: "old-password-123", password: "new-password-456" });
    expect(await screen.findByRole("status")).toHaveTextContent(PASSWORD_CHANGE_MESSAGES.done);
    expect(screen.queryByLabelText("Current password")).toBeNull();
  });

  it("shows a refusal on the field it is about and keeps the form open", async () => {
    m.changePassword.mockResolvedValue({ ok: false, code: "INVALID_INPUT", message: PASSWORD_CHANGE_MESSAGES.wrongCurrent, field: "current" });
    render(<ProfileSection name="Me" email="me@plan-markup.test" />);
    await userEvent.click(screen.getByRole("button", { name: "Change password…" }));
    await userEvent.type(screen.getByLabelText("Current password"), "wrong-one-123");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-456");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSWORD_CHANGE_MESSAGES.wrongCurrent);
    expect(screen.getByLabelText("Current password")).toHaveAttribute("aria-invalid", "true");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Current password")).toBeNull();
  });
});
