// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { LengthUnit } from "@/core/geometry/length";

import { NumberField } from "./number-field";

function Length({
  initial = 4600,
  unit = "m",
  onChange,
  ...rest
}: {
  initial?: number | null;
  unit?: LengthUnit;
  onChange?: (mm: number) => void;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
}) {
  const [mm, setMm] = useState<number | null>(initial);
  return (
    <>
      <NumberField
        kind="length"
        label="Ceiling height"
        unit={unit}
        value={mm}
        onValueChange={(v) => {
          setMm(v);
          onChange?.(v);
        }}
        {...rest}
      />
      <button>Elsewhere</button>
    </>
  );
}

function field() {
  return screen.getByRole("spinbutton", { name: "Ceiling height" }) as HTMLInputElement;
}

describe("NumberField (length)", () => {
  it("shows the bare number with a muted unit suffix", () => {
    render(<Length />);
    expect(field().value).toBe("4.6");
    expect(screen.getByText("m")).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["4.6", "m", 4600],
    ["4600 mm", "m", 4600],
    ["4.6m", "mm", 4600],
    ['15\'6"', "m", 4724.4],
  ] as const)("parses %s typed into a %s field", async (typed, unit, expected) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Length initial={1000} unit={unit} onChange={onChange} />);
    await user.clear(field());
    await user.type(field(), typed);
    await user.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBeCloseTo(expected, 6);
  });

  it("normalises to the display unit on blur", async () => {
    const user = userEvent.setup();
    render(<Length initial={1000} unit="m" />);
    await user.clear(field());
    await user.type(field(), "4600 mm");
    expect(field().value).toBe("4600 mm");
    await user.tab();
    expect(field().value).toBe("4.6");
  });

  it("normalises feet-inches text and shows no suffix", async () => {
    const user = userEvent.setup();
    render(<Length initial={1000} unit="ft-in" />);
    await user.clear(field());
    await user.type(field(), "15-6");
    await user.tab();
    expect(field().value).toBe('15\'6"');
    expect(screen.queryByText("m")).not.toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-valuetext", "15 feet 6 inches");
  });

  it("never reformats or errors while typing", async () => {
    const user = userEvent.setup();
    render(<Length />);
    await user.clear(field());
    await user.type(field(), "4.6 k");
    expect(field().value).toBe("4.6 k");
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/Enter a length/)).not.toBeInTheDocument();
  });

  it("shows an inline error on blur and keeps the last valid value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Length onChange={onChange} />);
    await user.clear(field());
    await user.type(field(), "abc");
    await user.tab();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription(/Enter a length like 4.6 m or 15'6"/);
    expect(onChange).not.toHaveBeenCalled();
    expect(field()).toHaveAttribute("aria-valuenow", "4.6");
  });

  it("clears the error after a valid commit", async () => {
    const user = userEvent.setup();
    render(<Length />);
    await user.clear(field());
    await user.type(field(), "abc");
    await user.tab();
    await user.clear(field());
    await user.type(field(), "3.2{Enter}");
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(field().value).toBe("3.2");
  });

  it("rejects negative lengths with a message", async () => {
    const user = userEvent.setup();
    render(<Length />);
    await user.clear(field());
    await user.type(field(), "-1{Enter}");
    expect(screen.getByText("Enter a length of 0 or more")).toBeInTheDocument();
  });

  it("commits on Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Length onChange={onChange} />);
    await user.clear(field());
    await user.type(field(), "5{Enter}");
    expect(onChange).toHaveBeenCalledWith(5000);
  });

  it("reverts the text with Escape", async () => {
    const user = userEvent.setup();
    render(<Length />);
    await user.clear(field());
    await user.type(field(), "9");
    await user.keyboard("{Escape}");
    expect(field().value).toBe("4.6");
    await user.type(field(), "abc");
    await user.tab();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    field().focus();
    await user.keyboard("{Escape}");
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(field().value).toBe("4.6");
  });

  it("steps with ArrowUp / ArrowDown and x10 with Shift and PageUp", async () => {
    const user = userEvent.setup();
    render(<Length />);
    await user.click(field());
    await user.keyboard("{ArrowUp}");
    expect(field().value).toBe("4.7");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(field().value).toBe("4.5");
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(field().value).toBe("5.5");
    await user.keyboard("{PageDown}");
    expect(field().value).toBe("4.5");
    await user.keyboard("{PageUp}");
    expect(field().value).toBe("5.5");
  });

  it("steps mm fields by 1 mm and ft-in fields by 1 inch", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Length unit="mm" initial={4600} />);
    await user.click(field());
    await user.keyboard("{ArrowUp}");
    expect(field().value).toBe("4601");
    unmount();
    render(<Length unit="ft-in" initial={152.4} />);
    await user.click(field());
    await user.keyboard("{ArrowUp}");
    expect(field().value).toBe('0\'7"');
  });

  it("clamps stepping and committed values to min and max (display units)", async () => {
    const user = userEvent.setup();
    render(<Length min={1} max={5} />);
    await user.click(field());
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(field().value).toBe("5");
    await user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{/Shift}");
    expect(field().value).toBe("1");
    await user.clear(field());
    await user.type(field(), "20{Enter}");
    expect(field().value).toBe("5");
  });

  it("steps from the typed text when it is valid", async () => {
    const user = userEvent.setup();
    render(<Length />);
    await user.clear(field());
    await user.type(field(), "2");
    await user.keyboard("{ArrowUp}");
    expect(field().value).toBe("2.1");
  });

  it("exposes spinbutton aria attributes", () => {
    render(<Length min={1.8} max={9} />);
    const input = field();
    expect(input).toHaveAttribute("aria-valuenow", "4.6");
    expect(input).toHaveAttribute("aria-valuemin", "1.8");
    expect(input).toHaveAttribute("aria-valuemax", "9");
    expect(input).toHaveAttribute("aria-valuetext", "4.6 m");
  });

  it("shows an external error and uses the right control height per layout", () => {
    const { unmount } = render(<Length error="Too tall for this room" />);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription("Too tall for this room");
    expect(field().className).toContain("h-7");
    unmount();
    render(
      <NumberField kind="length" unit="m" layout="admin" label="Ceiling height" value={4600} onValueChange={() => {}} />,
    );
    expect(field().className).toContain("h-10");
  });

  it("does not react to keys when disabled", async () => {
    const onChange = vi.fn();
    render(
      <NumberField kind="length" unit="m" disabled label="Ceiling height" value={4600} onValueChange={onChange} />,
    );
    expect(field()).toBeDisabled();
  });
});

describe("NumberField (number)", () => {
  function Plain({ onChange }: { onChange?: (n: number) => void }) {
    const [n, setN] = useState<number | null>(40);
    return (
      <NumberField
        label="Opacity"
        suffix="%"
        min={0}
        max={100}
        value={n}
        onValueChange={(v) => {
          setN(v);
          onChange?.(v);
        }}
      />
    );
  }

  it("accepts a trailing suffix in the typed text", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Plain onChange={onChange} />);
    const input = screen.getByRole("spinbutton", { name: "Opacity" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "55%{Enter}");
    expect(onChange).toHaveBeenCalledWith(55);
    expect(input.value).toBe("55");
    expect(screen.getByText("%")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-valuetext", "55 %");
  });

  it("shows 'Enter a number' on blur for bad input and steps with arrows", async () => {
    const user = userEvent.setup();
    render(<Plain />);
    const input = screen.getByRole("spinbutton", { name: "Opacity" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "forty");
    await user.tab();
    expect(screen.getByText("Enter a number")).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "40{Enter}");
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(input.value).toBe("50");
    await user.keyboard("{Shift>}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{/Shift}");
    expect(input.value).toBe("100");
  });
});
