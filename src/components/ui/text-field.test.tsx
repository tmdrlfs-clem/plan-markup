// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TextField } from "./text-field";

describe("TextField", () => {
  it("associates the label with the input", () => {
    render(<TextField label="Email" type="email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("describes the input by its hint", () => {
    render(<TextField label="Email" hint="Use your work address" />);
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Use your work address",
    );
  });

  it("flags an error with aria-invalid and aria-describedby", () => {
    render(
      <TextField label="Email" hint="Hint text" error="Enter a valid email" />,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Hint text Enter a valid email");
    expect(screen.getByText("Enter a valid email")).toBeVisible();
  });

  it("toggles password visibility", async () => {
    render(<TextField label="Password" type="password" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.click(
      screen.getByRole("button", { name: "Show password" }),
    );
    expect(input).toHaveAttribute("type", "text");
    await userEvent.click(
      screen.getByRole("button", { name: "Hide password" }),
    );
    expect(input).toHaveAttribute("type", "password");
  });

  it("accepts typed input", async () => {
    render(<TextField label="Name" />);
    const input = screen.getByLabelText("Name");
    await userEvent.type(input, "Ada");
    expect(input).toHaveValue("Ada");
  });
});
