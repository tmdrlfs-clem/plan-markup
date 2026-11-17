import { describe, expect, it } from "vitest";

import { ZONE_HAZARDS, markupSchema, type Markup, type ZoneMarkup } from "@/core/schema/markup";
import { hitMarkup } from "@/core/markup/geometry";
import { MarkupIndex } from "@/core/markup/markup-index";

import { HAZARDS, USE_HAZARD_V1, type UseHazardMap } from "./rules/rules";
import { defaultHoleTag, formatZoneArea, holeTagOf, mappingChange, newZone, nextZoneName, withHoleTag, withUse, zoneAreaM2, zoneChecklist, zoneHazard } from "./zone";

// 1 user unit = 10 mm: a 1000 × 800 ring is 10 m × 8 m.
const CAL = { xFactor: 10, yFactor: 10 };
const ID = "01890000-0000-7000-8000-000000000001";
const outer = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 800 },
  { x: 0, y: 800 },
];
const column = [
  { x: 100, y: 100 },
  { x: 140, y: 100 },
  { x: 140, y: 140 },
  { x: 100, y: 140 },
]; // 0.4 m × 0.4 m
const shaft = [
  { x: 500, y: 500 },
  { x: 650, y: 500 },
  { x: 650, y: 650 },
  { x: 500, y: 650 },
]; // 1.5 m × 1.5 m

function zone(name = "Zone 1"): ZoneMarkup {
  const z = newZone(
    {
      id: ID,
      pageId: "doc:0",
      createdAt: "2026-11-12T00:00:00Z",
      outer,
      holes: [column, shaft],
    },
    [],
    CAL,
  );
  return { ...z, zone: { ...z.zone, name } };
}

describe("zones (Story 9.2)", () => {
  it("makes a valid zone markup: next name, default use Office (ELH), holes tagged by size", () => {
    const z = newZone(
      {
        id: ID,
        pageId: "doc:0",
        createdAt: "2026-11-12T00:00:00Z",
        outer,
        holes: [column, shaft],
      },
      [zone("Zone 1"), zone("Zone 4")],
      CAL,
    );
    expect(markupSchema.safeParse(z).success).toBe(true);
    expect(z.zone).toEqual({
      name: "Zone 5",
      use: "Office",
      hazard: "ELH",
      holeTags: ["column", "shaft"],
    });
    expect(zoneHazard(z)).toBe("ELH");
    expect(zoneAreaM2(z, CAL)).toBeCloseTo(80 - 0.16 - 2.25, 6);
    expect(formatZoneArea(zoneAreaM2(z, CAL))).toBe("77.6 m²");
    expect(formatZoneArea(null)).toBe("—");
  });

  it("names, defaults and validation", () => {
    expect(nextZoneName([])).toBe("Zone 1");
    expect(nextZoneName([zone("Kitchen"), zone("Zone 2")])).toBe("Zone 3");
    expect(defaultHoleTag(0.5)).toBe("column");
    expect(defaultHoleTag(1)).toBe("shaft");
    expect(defaultHoleTag(null)).toBe("shaft");
    expect(markupSchema.safeParse({ ...zone(), zone: { name: " ", use: "Office" } }).success).toBe(false);
    expect(markupSchema.safeParse({ ...zone(), zone: { name: "A", use: "1nvalid" } }).success).toBe(false);
    expect(
      markupSchema.safeParse({
        ...zone(),
        zone: { name: "A", use: "Office", holeTags: ["pillar"] },
      }).success,
    ).toBe(false);
    expect(zoneHazard({ ...zone(), zone: { name: "A", use: "Hangar" } })).toBeNull();
  });

  it("a hole's tag: its own, else the default; changing one keeps the others", () => {
    const untagged: ZoneMarkup = {
      ...zone(),
      zone: { name: "Zone 1", use: "Office" },
    };
    expect(holeTagOf(untagged, 0, CAL)).toBe("column");
    expect(holeTagOf(untagged, 1, CAL)).toBe("shaft");
    const changed = withHoleTag(untagged, 0, "shaft", CAL);
    expect(changed.zone.holeTags).toEqual(["shaft", "shaft"]);
    expect(withHoleTag(untagged, 5, "shaft", CAL)).toBe(untagged);
  });

  it("the checklist ticks itself", () => {
    expect(zoneChecklist([])).toEqual({
      zones: false,
      uses: false,
      heads: false,
    });
    expect(zoneChecklist([zone()])).toEqual({
      zones: true,
      uses: true,
      heads: false,
    });
    expect(zoneChecklist([zone(), { ...zone(), zone: { name: "B", use: "Hangar" } }]).uses).toBe(false);
  });

  it("is hit inside (not in a hole) and loses to any other markup there", () => {
    const z = zone();
    expect(hitMarkup(z, { x: 300, y: 300 }, 1)).toBe(true);
    expect(hitMarkup(z, { x: 120, y: 120 }, 1)).toBe(false);
    const line: Markup = {
      id: "01890000-0000-7000-8000-000000000002",
      pageId: "doc:0",
      createdAt: "",
      style: z.style,
      type: "line",
      points: [
        { x: 290, y: 300 },
        { x: 310, y: 300 },
      ],
    };
    // The zone drawn after the line still yields to it.
    expect(new MarkupIndex([line, z], 1).hit({ x: 300, y: 300 }, 2)?.id).toBe(line.id);
    expect(new MarkupIndex([line, z], 1).hit({ x: 600, y: 300 }, 2)?.id).toBe(z.id);
  });
});

describe("a zone keeps the class its use gave it (Story 10.12, FR72)", () => {
  const changed: UseHazardMap = { ...USE_HAZARD_V1, version: "2", uses: USE_HAZARD_V1.uses.filter((u) => u.use !== "Storage").map((u) => (u.use === "Office" ? { ...u, hazard: "OH1" } : u)) };

  it("has the same classes as the rules", () => {
    expect(ZONE_HAZARDS).toEqual(HAZARDS);
  });

  it("a new zone takes the default use's class; a later mapping does not re-class it", () => {
    const z = zone();
    expect(z.zone.hazard).toBe("ELH");
    expect(zoneHazard(z, changed)).toBe("ELH");
    expect(newZone({ id: ID, pageId: "doc:0", createdAt: "2026-11-12T00:00:00Z", outer, holes: [] }, [], CAL, 1, changed).zone).toMatchObject({ use: "Office", hazard: "OH1" });
    // A zone drawn before classes were kept follows the mapping.
    expect(zoneHazard({ ...z, zone: { name: "A", use: "Office" } }, changed)).toBe("OH1");
  });

  it("choosing a use gives its class under the mapping in force, keeping the name, tags and options", () => {
    const z = { ...zone(), zone: { name: "A", use: "Office", hazard: "ELH" as const, holeTags: ["column" as const], options: { grid: 600 } } };
    expect(withUse(z, "Storage").zone).toEqual({ name: "A", use: "Storage", hazard: "OH2", holeTags: ["column"], options: { grid: 600 } });
    expect(withUse(z, "Office", changed).zone.hazard).toBe("OH1");
    expect(withUse(z, "Hangar").zone).toEqual({ name: "A", use: "Hangar", holeTags: ["column"], options: { grid: 600 } });
    expect(markupSchema.safeParse(withUse(z, "Storage")).success).toBe(true);
    expect(markupSchema.safeParse({ ...z, zone: { ...z.zone, hazard: "HH" } }).success).toBe(false);
  });

  it("tells a kept class from today's mapping", () => {
    const office = zone();
    const store = withUse(zone(), "Storage");
    expect(mappingChange(office)).toBeNull();
    expect(mappingChange(office, changed)).toEqual({ kept: "ELH", now: "OH1" });
    expect(mappingChange(store, changed)).toEqual({ kept: "OH2", now: null });
    expect(mappingChange({ ...office, zone: { name: "A", use: "Office" } }, changed)).toBeNull();
    expect(zoneChecklist([office, store], changed).uses).toBe(true);
  });
});
