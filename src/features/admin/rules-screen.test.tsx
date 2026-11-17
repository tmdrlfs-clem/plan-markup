// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  saveRuleFigures: vi.fn(),
  confirmRuleFigures: vi.fn(),
  saveDefaultUseMap: vi.fn(),
  confirmDefaultUseMap: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("./rules-actions", () => ({
  saveRuleFigures: m.saveRuleFigures,
  confirmRuleFigures: m.confirmRuleFigures,
  saveDefaultUseMap: m.saveDefaultUseMap,
  confirmDefaultUseMap: m.confirmDefaultUseMap,
}));
vi.mock("@/features/company/use-map-actions", () => ({ saveCompanyUseMap: vi.fn(), resetCompanyUseMap: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/components/ui/toast-store", () => ({ toast: m.toast }));

import { NZS4541_V1, USE_HAZARD_V1, type RuleFiguresRow } from "@/core/sprinkler/rules/rules";
import type { ResolvedUseMap } from "@/core/sprinkler/use-map";

import { parseFigure } from "./rule-figures-form";
import { RulesScreen, figureChanges, versionsOf } from "./rules-screen";

const row = (version: string, verified: boolean, change: object = {}, source = `Source of v${version}`): RuleFiguresRow => ({
  ruleset_id: "nzs4541",
  version,
  verified,
  source,
  hazards: { ...NZS4541_V1.hazards, ELH: { ...NZS4541_V1.hazards.ELH, ...change } },
  tables: NZS4541_V1.tables,
  created_at: `2026-11-${10 + Number(version)}T00:00:00Z`,
  verified_at: verified ? `2026-11-${10 + Number(version)}T01:00:00Z` : null,
});
const V1 = row("1", true);
const DRAFT_MAP: ResolvedUseMap = { source: "platform", map: { ...USE_HAZARD_V1, verified: false } };

const show = (figures: RuleFiguresRow[], mapping: ResolvedUseMap = DRAFT_MAP) => render(<RulesScreen figures={figures} mapping={mapping} />);
const cell = (name: string) => screen.getByRole("textbox", { name });

beforeEach(() => {
  vi.clearAllMocks();
  m.saveRuleFigures.mockResolvedValue({ ok: true, data: { changed: true, version: "2" } });
  m.confirmRuleFigures.mockResolvedValue({ ok: true, data: { changed: true } });
  m.saveDefaultUseMap.mockResolvedValue({ ok: true, data: { changed: true, version: "2" } });
  m.confirmDefaultUseMap.mockResolvedValue({ ok: true, data: { changed: true } });
});

describe("versionsOf / figureChanges", () => {
  it("names what each version is now: in use, draft, earlier, replaced draft", () => {
    const versions = versionsOf([V1, row("2", false, { Amax: 20 }), row("3", true, { Amax: 20.5 }), row("4", false, { Amax: 19 }), { ...V1, ruleset_id: "other" }]);
    expect(versions.map((v) => `${v.rules.version}:${v.status}`)).toEqual(["4:draft", "3:in use", "2:replaced draft", "1:earlier"]);
    expect(figureChanges(versions[1].rules, versions[0].rules)).toEqual(["ELH Amax 20.5 → 19"]);
    expect(figureChanges(undefined, versions[0].rules)).toEqual([]);
  });

  it("leaves out a row that does not read as a rule set", () => {
    expect(versionsOf([V1, { ...row("2", true), hazards: { ELH: {} } }]).map((v) => v.rules.version)).toEqual(["1"]);
  });
});

describe("parseFigure", () => {
  it("reads decimals with a point or a comma and nothing else", () => {
    expect(parseFigure(" 4.6 ")).toBe(4.6);
    expect(parseFigure("4,6")).toBe(4.6);
    expect(parseFigure("21")).toBe(21);
    for (const bad of ["", "abc", "1e3", "-2", "4.6m", "1.2.3"]) expect(parseFigure(bad)).toBeNaN();
  });
});

describe("RulesScreen (Story 10.13)", () => {
  it("shows the version in use, its figures to edit from, and the versions", () => {
    show([V1]);
    expect(screen.getByTestId("rules-in-use")).toHaveTextContent("NZS 4541 v1 is in use.");
    expect(screen.queryByTestId("rules-draft")).toBeNull();
    expect(cell("Max area per head of ELH, in square metres")).toHaveValue("21");
    expect(cell("Max spacing of OH2, in metres")).toHaveValue("4");
    const versions = screen.getAllByTestId("rule-version-row");
    expect(versions).toHaveLength(1);
    expect(versions[0]).toHaveTextContent("v1");
    expect(versions[0]).toHaveTextContent("In use");
    expect(versions[0]).toHaveTextContent("Source of v1");
  });

  it("saves edited figures as a new version, with their source", async () => {
    const user = userEvent.setup();
    show([V1]);
    const amax = cell("Max area per head of ELH, in square metres");
    await user.clear(amax);
    await user.type(amax, "20,5");
    await user.type(screen.getByRole("textbox", { name: "Source of the change" }), "Clause 5 correction");
    await user.click(screen.getByRole("button", { name: "Save as a new version" }));
    await waitFor(() => expect(m.saveRuleFigures).toHaveBeenCalledTimes(1));
    expect(m.saveRuleFigures).toHaveBeenCalledWith({
      hazards: { ...NZS4541_V1.hazards, ELH: { ...NZS4541_V1.hazards.ELH, Amax: 20.5 } },
      source: "Clause 5 correction",
    });
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ variant: "success", title: "Saved as v2, a draft.", description: "Nobody uses it until you confirm it." }));
    expect(m.refresh).toHaveBeenCalled();
  });

  it("refuses figures that are not numbers in range, a minimum above its maximum and a missing source, without saving", async () => {
    const user = userEvent.setup();
    show([V1]);
    const smin = cell("Min spacing of OH1, in metres");
    await user.clear(smin);
    await user.type(smin, "5");
    const wmax = cell("Max to wall of OH3, in metres");
    await user.clear(wmax);
    await user.type(wmax, "two");
    await user.click(screen.getByRole("button", { name: "Save as a new version" }));
    const alerts = screen.getByRole("alert");
    expect(alerts).toHaveTextContent("OH1 min spacing: Min spacing must be below max spacing.");
    expect(alerts).toHaveTextContent("OH3 max to wall: Enter a number.");
    expect(smin).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Say where the figures come from.")).toBeInTheDocument();
    expect(m.saveRuleFigures).not.toHaveBeenCalled();
  });

  it("shows the server's refusal, and an unchanged save", async () => {
    const user = userEvent.setup();
    show([V1]);
    await user.type(screen.getByRole("textbox", { name: "Source of the change" }), "Same again");
    m.saveRuleFigures.mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "You don't have access to this." });
    await user.click(screen.getByRole("button", { name: "Save as a new version" }));
    expect(await screen.findByText("You don't have access to this.")).toBeInTheDocument();
    m.saveRuleFigures.mockResolvedValueOnce({ ok: true, data: { changed: false, version: "1" } });
    await user.click(screen.getByRole("button", { name: "Save as a new version" }));
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ variant: "info", title: "Nothing changed: these are the figures of v1." }));
  });

  it("a draft is not in use: it shows what changed and is confirmed only after asking", async () => {
    const user = userEvent.setup();
    show([row("2", false, { Amax: 20 }, "Clause 5 correction"), V1]);
    expect(screen.getByTestId("rules-in-use")).toHaveTextContent("NZS 4541 v1 is in use.");
    const draft = screen.getByTestId("rules-draft");
    expect(draft).toHaveTextContent("v2 is a draft. Nobody uses it yet.");
    expect(draft).toHaveTextContent("Changed from v1: ELH Amax 21 → 20.");
    // The form starts from the draft.
    expect(cell("Max area per head of ELH, in square metres")).toHaveValue("20");
    expect(screen.getAllByTestId("rule-version-row").map((r) => r.textContent)).toEqual([
      expect.stringContaining("Draft"),
      expect.stringContaining("In use"),
    ]);

    await user.click(within(draft).getByRole("button", { name: "Confirm v2" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Put v2 in use?" });
    expect(dialog).toHaveTextContent("every new placement and every check uses them");
    expect(m.confirmRuleFigures).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirm v2" }));
    await waitFor(() => expect(m.confirmRuleFigures).toHaveBeenCalledWith({ version: "2" }));
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ variant: "success", title: "v2 is in use." }));
  });

  it("cancelling the confirmation confirms nothing; a refusal is said", async () => {
    const user = userEvent.setup();
    show([row("2", false, { Amax: 20 }), V1]);
    await user.click(screen.getByRole("button", { name: "Confirm v2" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(m.confirmRuleFigures).not.toHaveBeenCalled();
    m.confirmRuleFigures.mockResolvedValueOnce({ ok: false, code: "CONFLICT", message: "A newer version has been added since. Check it before confirming." });
    await user.click(screen.getByRole("button", { name: "Confirm v2" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirm v2" }));
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ variant: "danger", title: "A newer version has been added since. Check it before confirming." }));
  });

  it("the default mapping: a draft is confirmed, an edit is saved through the platform's action", async () => {
    const user = userEvent.setup();
    show([V1]);
    expect(screen.getByTestId("default-map-status")).toHaveTextContent("Mapping v1 is a draft, not yet verified.");
    expect(screen.queryByRole("button", { name: "Use the platform default" })).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Hazard class of Kitchen" }), "OH2");
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(m.saveDefaultUseMap).toHaveBeenCalledTimes(1));
    expect(m.saveDefaultUseMap.mock.calls[0][0]).toMatchObject({ defaultUse: "Office", uses: expect.arrayContaining([{ use: "Kitchen", hazard: "OH2" }]) });
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success", title: "Default mapping saved (v2)." })));

    await user.click(screen.getByRole("button", { name: "Confirm mapping v1" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Mark mapping v1 as verified?" })).getByRole("button", { name: "Confirm mapping v1" }));
    await waitFor(() => expect(m.confirmDefaultUseMap).toHaveBeenCalledWith({ version: "1" }));
  });

  it("a verified mapping has nothing to confirm", () => {
    show([V1], { source: "platform", map: { ...USE_HAZARD_V1, version: "3", verified: true } });
    expect(screen.getByTestId("default-map-status")).toHaveTextContent("Mapping v3 is verified.");
    expect(screen.queryByRole("button", { name: /Confirm mapping/ })).toBeNull();
  });
});
