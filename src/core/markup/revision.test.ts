import { describe, expect, it } from "vitest";

import { markupSchema, type Markup } from "@/core/schema/markup";

import { fieldsOf, sharedFields, withChange } from "./properties";
import { DEFAULT_REVISION_STYLE, REVISION_SIZE_PT, latestRevision, localDate, newRevisionMeta, nextRevision, revisionLabel, revisionMarkupAt, revisionText } from "./revision";

const upright = (p: { x: number; y: number }) => ({ x: p.x, y: -p.y });
const stamp = (rev: string, createdAt: string, id = "00000000-0000-4000-8000-000000000001") =>
  revisionMarkupAt({ rev, description: "As-built", author: "Kim", date: "2026-11-07" }, { x: 100, y: 100 }, "p:0", upright, 1, id, createdAt);

describe("revision stamp (Story 7.7, FR37)", () => {
  it("the next revision counts the last letters or digits on", () => {
    expect(nextRevision(null)).toBe("A");
    expect(nextRevision("A")).toBe("B");
    expect(nextRevision("C")).toBe("D");
    expect(nextRevision("Z")).toBe("AA");
    expect(nextRevision("AZ")).toBe("BA");
    expect(nextRevision("b")).toBe("c");
    expect(nextRevision("3")).toBe("4");
    expect(nextRevision("09")).toBe("10");
    expect(nextRevision("P1")).toBe("P2");
    expect(nextRevision("Rev-")).toBe("Rev-");
  });

  it("a new stamp: after the document's latest revision, today's local date, the author, As-built", () => {
    const markups: Markup[] = [stamp("B", "2026-11-01T00:00:00Z"), stamp("A", "2026-10-01T00:00:00Z", "00000000-0000-4000-8000-000000000002")];
    expect(latestRevision(markups)).toBe("B");
    expect(newRevisionMeta(markups, "Kim", new Date(2026, 10, 7, 23, 30))).toEqual({ rev: "C", description: "As-built", author: "Kim", date: "2026-11-07" });
    expect(newRevisionMeta([], "Kim").rev).toBe("A");
    expect(localDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("placed: centred on the click, upright, its size over the page's UserUnit, a valid markup", () => {
    const m = stamp("A", "2026-11-07T00:00:00Z");
    expect(markupSchema.safeParse(m).success).toBe(true);
    const { width, height } = REVISION_SIZE_PT;
    expect(m.points).toEqual([
      { x: 100 - width / 2, y: 100 + height / 2 },
      { x: 100 + width / 2, y: 100 + height / 2 },
      { x: 100 + width / 2, y: 100 - height / 2 },
      { x: 100 - width / 2, y: 100 - height / 2 },
    ]);
    expect(m.style).toEqual(DEFAULT_REVISION_STYLE);
    const big = revisionMarkupAt(m.revision, { x: 0, y: 0 }, "p:0", upright, 2, m.id, m.createdAt);
    expect(big.points[1].x - big.points[0].x).toBe(width / 2);
  });

  it("its text and label", () => {
    expect(revisionText({ rev: "C", description: "As-built", author: "", date: "2026-11-07" })).toEqual({ left: "Rev C", right: "2026-11-07", lines: ["As-built"] });
    expect(revisionLabel({ rev: "C", description: "As-built", author: "Kim", date: "2026-11-07" })).toBe("Revision C — As-built");
  });

  it("Properties: its fields for one stamp; a change keeps a valid stamp only", () => {
    const m = stamp("A", "2026-11-07T00:00:00Z");
    expect([...fieldsOf(m)]).toEqual(expect.arrayContaining(["subject", "revision", "color", "fill", "width", "opacity", "fontSize"]));
    expect(sharedFields([m, { ...m, id: "00000000-0000-4000-8000-000000000003" }])).not.toContain("revision");
    const c = withChange(m, { revision: { rev: "C", description: "Issued for construction" } });
    expect(c).toMatchObject({ revision: { rev: "C", description: "Issued for construction", author: "Kim", date: "2026-11-07" } });
    expect(withChange(m, { revision: { rev: " " } })).toBe(m);
    expect(withChange(m, { revision: { date: "7/11/2026" } })).toBe(m);
    expect(withChange(m, { revision: { rev: "A" } })).toBe(m);
  });
});
