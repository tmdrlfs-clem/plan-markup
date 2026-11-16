// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ createCompany: vi.fn(), setPlan: vi.fn(), refresh: vi.fn(), toast: vi.fn(), pathname: "/admin/companies" }));
vi.mock("./company-actions", () => ({ createCompany: m.createCompany }));
vi.mock("./plan-actions", () => ({ setPlan: m.setPlan }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }), usePathname: () => m.pathname }));
vi.mock("@/components/ui/toast-store", () => ({ toast: m.toast }));

import type { AdminCompanyRow } from "@/lib/db/admin-companies";
import { AdminNav } from "./admin-nav";
import { CompaniesScreen } from "./companies-screen";

const ACME: AdminCompanyRow = {
  id: "00000000-0000-4000-8000-0000000000c1",
  name: "Acme Fire",
  plan: "pilot",
  createdAt: "2026-11-15T22:00:00Z",
  memberCount: 3,
  admins: [
    { name: "Pat Admin", email: "pat@plan-markup.test" },
    { name: "", email: "sam@plan-markup.test" },
  ],
};

beforeEach(() => vi.clearAllMocks());

async function fill(name: string, email: string) {
  await userEvent.type(screen.getByLabelText("Company name"), name);
  await userEvent.type(screen.getByLabelText("First admin's email"), email);
  await userEvent.click(screen.getByRole("button", { name: "Create company" }));
}

describe("CompaniesScreen", () => {
  it("lists companies with their admins, member count and date", () => {
    render(<CompaniesScreen companies={[ACME, { ...ACME, id: "c2", name: "Beta Sprinklers", admins: [], memberCount: 0 }]} />);
    const row = screen.getByRole("row", { name: /Acme Fire/ });
    expect(within(row).getByText("Pat Admin")).toBeInTheDocument();
    expect(within(row).getByText("sam@plan-markup.test")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("16 Nov 2026")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Beta Sprinklers/ })).getByText("No admin")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 companies");
  });

  it("shows the company's plan and saves a change at once (Story 10.8)", async () => {
    m.setPlan.mockResolvedValueOnce({ ok: true, data: { plan: "standard", changed: true } });
    render(<CompaniesScreen companies={[ACME]} />);
    const select = screen.getByRole("combobox", { name: "Plan of Acme Fire" });
    expect(select).toHaveValue("pilot");
    await userEvent.selectOptions(select, "standard");
    expect(m.setPlan).toHaveBeenCalledWith({ targetType: "company", targetId: ACME.id, plan: "standard" });
    expect(m.toast).toHaveBeenCalledWith({ variant: "success", title: "Acme Fire is on the Standard plan." });
    expect(m.refresh).toHaveBeenCalled();
  });

  it("says so when there are none", () => {
    render(<CompaniesScreen companies={[]} />);
    expect(screen.getByText("No companies yet. Create the first one above.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 companies");
  });

  it("creates a company, clears the form and refreshes the list", async () => {
    m.createCompany.mockResolvedValue({ ok: true, data: { id: "c9", name: "Acme Fire" } });
    render(<CompaniesScreen companies={[]} />);
    await fill("Acme Fire", "pat@plan-markup.test");
    expect(m.createCompany).toHaveBeenCalledWith({ name: "Acme Fire", adminEmail: "pat@plan-markup.test" });
    expect(m.toast).toHaveBeenCalledWith({ variant: "success", title: "Acme Fire is created." });
    expect(m.refresh).toHaveBeenCalled();
    expect(screen.getByLabelText("Company name")).toHaveValue("");
  });

  it("shows a refusal on its field, keeps what was typed and moves focus there", async () => {
    m.createCompany.mockResolvedValue({ ok: false, code: "CONFLICT", message: "This person already belongs to a company.", field: "adminEmail" });
    render(<CompaniesScreen companies={[]} />);
    await fill("Acme Fire", "pat@plan-markup.test");
    const email = screen.getByLabelText("First admin's email");
    expect(email).toHaveAccessibleDescription("This person already belongs to a company.");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveFocus();
    expect(screen.getByLabelText("Company name")).toHaveValue("Acme Fire");
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("shows a refusal without a field as an alert", async () => {
    m.createCompany.mockResolvedValue({ ok: false, code: "INTERNAL", message: "Something went wrong on our side. Try again shortly." });
    render(<CompaniesScreen companies={[]} />);
    await fill("Acme Fire", "pat@plan-markup.test");
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on our side.");
  });
});

describe("AdminNav", () => {
  it("marks the current section", () => {
    render(<AdminNav />);
    expect(screen.getByRole("link", { name: "Companies" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Accounts" })).not.toHaveAttribute("aria-current");
  });
});
