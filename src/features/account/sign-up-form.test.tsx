// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const action = vi.hoisted(() => ({
  state: { status: "idle" } as
    | { status: "idle" }
    | { status: "sent"; email: string }
    | { status: "error"; code: string; message: string; fieldErrors?: Record<string, string> },
}));

vi.mock("./sign-up-actions", () => ({ signUp: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: () => [action.state, vi.fn(), false] };
});

import { LINK_INVALID_NOTICE, SignInForm } from "./sign-in-form";
import { PASSWORD_MESSAGES } from "./sign-up-schema";
import { SENT_HEADING, SignUpForm } from "./sign-up-form";

vi.mock("./actions", () => ({ signIn: vi.fn() }));

describe("SignUpForm", () => {
  it("has email, a new password with show/hide, and a link to sign in", () => {
    action.state = { status: "idle" };
    render(<SignUpForm />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByTestId("turnstile")).toBeNull();
  });

  it("shows the Turnstile check when a site key is set", () => {
    action.state = { status: "idle" };
    render(<SignUpForm turnstileSiteKey="1x00000000000000000000AA" />);
    expect(screen.getByTestId("turnstile")).toBeInTheDocument();
  });

  it("checks the password length on blur", async () => {
    action.state = { status: "idle" };
    render(<SignUpForm />);
    await userEvent.type(screen.getByLabelText("Password"), "too-short");
    await userEvent.tab();
    expect(screen.getByText(PASSWORD_MESSAGES.short)).toBeInTheDocument();
  });

  it("after submitting, says to check the email without saying whether it exists", () => {
    action.state = { status: "sent", email: "new@plan-markup.test" };
    render(<SignUpForm />);
    expect(screen.getByRole("heading", { name: SENT_HEADING })).toBeInTheDocument();
    expect(screen.getByTestId("sign-up-sent")).toHaveTextContent("If new@plan-markup.test can be used");
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/sign-in");
  });
});

describe("SignInForm (Story 10.1 additions)", () => {
  it("links to sign-up and explains a bad confirmation link", () => {
    action.state = { status: "idle" };
    render(<SignInForm next="/workspace" linkInvalid />);
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up");
    expect(screen.getByRole("alert")).toHaveTextContent(LINK_INVALID_NOTICE);
  });
});
