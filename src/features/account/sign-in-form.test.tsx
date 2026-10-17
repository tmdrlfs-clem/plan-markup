// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const action = vi.hoisted(() => ({
  state: { status: "idle" } as
    | { status: "idle" }
    | { status: "error"; code: string; message: string; fieldErrors?: Record<string, string> },
}));

// The server action module cannot load in jsdom; the form only needs its shape.
vi.mock("./actions", () => ({ signIn: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: () => [action.state, vi.fn(), false] };
});

import { SignInForm } from "./sign-in-form";

describe("SignInForm", () => {
  it("associates labels with the inputs", () => {
    action.state = { status: "idle" };
    render(<SignInForm next="/workspace" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute("type", "submit");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the server message in an alert with an icon", () => {
    action.state = {
      status: "error",
      code: "UNAUTHENTICATED",
      message: "Email or password is incorrect.",
    };
    render(<SignInForm next="/workspace" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Email or password is incorrect.");
    expect(alert.querySelector("svg")).not.toBeNull();
  });

  it("shows inline errors and focuses the email field when submitted empty", async () => {
    action.state = { status: "idle" };
    const user = userEvent.setup();
    render(<SignInForm next="/workspace" />);
    await user.click(screen.getByLabelText("Password"));
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("carries the sanitised next path in a hidden input", () => {
    action.state = { status: "idle" };
    const { container } = render(<SignInForm next="/workspace/a" />);
    expect(container.querySelector('input[type="hidden"][name="next"]')).toHaveValue("/workspace/a");
  });
});
