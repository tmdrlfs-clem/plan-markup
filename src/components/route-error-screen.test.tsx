// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteErrorBoundary } from "./route-error-boundary";
import { RouteErrorScreen } from "./route-error-screen";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/sentry/report", () => ({ reportError: vi.fn() }));

const MARKUPS = "Your markups are saved locally.";

function sqlError(digest?: string) {
  const error = new Error("SELECT * FROM profiles WHERE email='a@b.co'");
  return digest === undefined ? error : Object.assign(error, { digest });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RouteErrorBoundary leak checks", () => {
  it("shows the fixed copy and never the error message", () => {
    const { container } = render(<RouteErrorBoundary error={sqlError("2918472301")} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Something stopped working");
    expect(text).toContain(MARKUPS);
    expect(text).toContain("Reload");
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain("a@b.co");
  });

  it("shows the digest only inside the closed Details disclosure", () => {
    const { container } = render(<RouteErrorBoundary error={sqlError("2918472301")} />);
    const details = container.querySelector("details")!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Details");
    expect(details.textContent).toContain("Error ID 2918472301");
    const outside = (container.textContent ?? "").replace(details.textContent ?? "", "");
    expect(outside).not.toContain("2918472301");
  });

  it.each(["<script>", "x".repeat(100), ""])("renders no Error ID for an unsafe digest %j", (digest) => {
    const { container } = render(<RouteErrorBoundary error={sqlError(digest)} />);
    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent).not.toContain("Error ID");
    expect(container.innerHTML).not.toContain("<script>");
  });

  it("never shows a thrown non-Error value", () => {
    const { container } = render(<RouteErrorBoundary error="Riser note" />);
    expect(container.textContent).not.toContain("Riser");
  });

  it("has one h1, one main and a primary Reload button", () => {
    const { container } = render(<RouteErrorBoundary error={sqlError()} />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    const button = screen.getByRole("button", { name: "Reload" });
    expect(button).toHaveAttribute("data-variant", "primary");
  });

  it("focuses the heading on mount", () => {
    render(<RouteErrorBoundary error={sqlError()} />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });
});

describe("RouteErrorScreen variants", () => {
  it("app variant keeps the markups line", () => {
    const { container } = render(<RouteErrorScreen variant="app" onReload={() => {}} />);
    expect(container.textContent).toContain(MARKUPS);
  });

  it("auth variant drops the markups line and keeps heading and Reload", () => {
    const { container } = render(
      <main>
        <RouteErrorScreen variant="auth" as="div" onReload={() => {}} />
      </main>,
    );
    expect(container.textContent).not.toContain(MARKUPS);
    expect(container.textContent).toContain("Something stopped working");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    // Inside the (auth) layout's <main>: exactly one main on the page.
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });
});
