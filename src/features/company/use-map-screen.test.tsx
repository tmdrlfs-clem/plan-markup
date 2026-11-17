// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ saveCompanyUseMap: vi.fn(), resetCompanyUseMap: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("./use-map-actions", () => ({ saveCompanyUseMap: m.saveCompanyUseMap, resetCompanyUseMap: m.resetCompanyUseMap }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/components/ui/toast-store", () => ({ toast: m.toast }));

import { USE_HAZARD_V1 } from "@/core/sprinkler/rules/rules";
import type { ResolvedUseMap } from "@/core/sprinkler/use-map";

import { UseMapScreen } from "./use-map-screen";

const PLATFORM: ResolvedUseMap = { source: "platform", map: { ...USE_HAZARD_V1, verified: false } };
const OWN: ResolvedUseMap = {
  source: "company",
  map: {
    ...USE_HAZARD_V1,
    version: "2",
    verified: true,
    defaultUse: "Lab",
    uses: [
      { use: "Lab", hazard: "OH3" },
      { use: "Office", hazard: "OH1" },
    ],
  },
};

const show = (resolved: ResolvedUseMap) => render(<UseMapScreen companyName="Acme Fire" resolved={resolved} />);
const rows = () => screen.getAllByTestId("use-row");
const save = () => screen.getByRole("button", { name: "Save mapping" });

beforeEach(() => {
  vi.clearAllMocks();
  m.saveCompanyUseMap.mockResolvedValue({ ok: true, data: { changed: true, version: "3" } });
  m.resetCompanyUseMap.mockResolvedValue({ ok: true, data: { changed: true, version: null } });
});

describe("UseMapScreen (Story 10.12)", () => {
  it("starts from the platform default when the company has no mapping of its own", () => {
    show(PLATFORM);
    expect(screen.getByTestId("use-map-source")).toHaveTextContent("Acme Fire follows the platform default mapping (a draft, not yet verified).");
    expect(rows()).toHaveLength(USE_HAZARD_V1.uses.length);
    expect(screen.getByRole("radio", { name: `${USE_HAZARD_V1.defaultUse} is the default use` })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Use the platform default" })).toBeNull();
  });

  it("saves an edited mapping as a whole and refreshes", async () => {
    const user = userEvent.setup();
    show(OWN);
    expect(screen.getByTestId("use-map-source")).toHaveTextContent("Acme Fire has its own mapping (v2).");
    await user.selectOptions(screen.getByRole("combobox", { name: "Hazard class of Office" }), "OH2");
    await user.click(screen.getByRole("button", { name: "Add a use" }));
    const added = screen.getByRole("textbox", { name: "Name of use 3" });
    await waitFor(() => expect(added).toHaveFocus());
    await user.type(added, "Plant room");
    await user.click(screen.getByRole("radio", { name: "Plant room is the default use" }));
    await user.click(screen.getByRole("button", { name: "Remove Lab" }));
    await user.click(save());
    expect(m.saveCompanyUseMap).toHaveBeenCalledWith({
      defaultUse: "Plant room",
      uses: [
        { use: "Office", hazard: "OH2" },
        { use: "Plant room", hazard: "OH1" },
      ],
    });
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success", title: "Mapping saved (v3)." }));
    expect(m.refresh).toHaveBeenCalled();
  });

  it("says so when nothing changed", async () => {
    m.saveCompanyUseMap.mockResolvedValueOnce({ ok: true, data: { changed: false, version: "2" } });
    const user = userEvent.setup();
    show(OWN);
    await user.click(save());
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }));
  });

  it("shows each problem at its row and does not save", async () => {
    const user = userEvent.setup();
    show(OWN);
    const office = screen.getByRole("textbox", { name: "Name of use 2" });
    await user.clear(office);
    await user.type(office, "lab");
    await user.click(save());
    expect(within(rows()[1]).getByText("“lab” is listed twice.")).toBeInTheDocument();
    expect(office).toHaveAttribute("aria-invalid", "true");
    expect(office).toHaveFocus();
    expect(m.saveCompanyUseMap).not.toHaveBeenCalled();
    // Typing in the row clears its message.
    await user.type(office, "s");
    expect(screen.queryByText(/listed twice/)).toBeNull();

    await user.clear(office);
    await user.type(office, "9 lives");
    await user.click(save());
    expect(within(rows()[1]).getByText(/^Start with a letter/)).toBeInTheDocument();
    expect(m.saveCompanyUseMap).not.toHaveBeenCalled();
  });

  it("asks for a default when its use was removed, and keeps one use at least", async () => {
    const user = userEvent.setup();
    show(OWN);
    await user.click(screen.getByRole("button", { name: "Remove Lab" }));
    expect(screen.getByRole("button", { name: "Remove Office" })).toBeDisabled();
    await user.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the default use.");
    expect(m.saveCompanyUseMap).not.toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    m.saveCompanyUseMap.mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "You don't have access to this." });
    const user = userEvent.setup();
    show(OWN);
    await user.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("You don't have access to this.");
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("goes back to the platform default only after confirming", async () => {
    const user = userEvent.setup();
    show(OWN);
    await user.click(screen.getByRole("button", { name: "Use the platform default" }));
    const dialog = screen.getByRole("alertdialog", { name: "Go back to the platform default?" });
    expect(m.resetCompanyUseMap).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Use the platform default" }));
    expect(m.resetCompanyUseMap).toHaveBeenCalledTimes(1);
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success", title: "Your company uses the platform default mapping again." }));
    expect(m.refresh).toHaveBeenCalled();
  });
});
