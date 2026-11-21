import { describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";

import type { MarkupListRow } from "./markup-list";
import { csvField, summaryCsv, summaryFileName } from "./summary";

const row = (markup: Partial<Markup> & { type: Markup["type"] }, extra: Partial<MarkupListRow> = {}): MarkupListRow => ({
  id: "1",
  type: markup.type,
  subject: "Text box",
  pageIndex: 0,
  page: "A-101",
  date: "2026-11-21T00:00:00.000Z",
  color: "#FF0000",
  layer: "",
  device: "",
  value: "",
  measure: null,
  markup: { id: "1", pageId: "d:0", createdAt: "", style: DEFAULT_MARKUP_STYLE, points: [], ...markup } as Markup,
  ...extra,
});

describe("markup summary CSV", () => {
  it("one header row and one row a markup, with text, replacement and link address", () => {
    const csv = summaryCsv(
      [
        row({ type: "text", text: 'Say "hi", then\nleave' }),
        row({ type: "strikethrough", text: "ROOM 1", replacement: "ROOM 2" }, { subject: "Strikethrough" }),
        row({ type: "length" }, { subject: "Length", value: "4 200 mm" }),
      ],
      "Kim",
    );
    const lines = csv.slice(1).split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe("Page,Subject,Type,Date,Author,Colour,Layer,Device,Measurement,Text");
    expect(lines[1]).toBe('A-101,Text box,Text box,2026-11-21T00:00:00.000Z,Kim,#ff0000,,,,"Say ""hi"", then\nleave"'.split("\r\n")[0]);
    expect(csv).toContain("ROOM 1 → ROOM 2");
    expect(csv).toContain("Length,Length,2026-11-21T00:00:00.000Z,Kim,#ff0000,,,4 200 mm,");
  });

  it("defuses spreadsheet formulas and names the file after the drawing", () => {
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("-3")).toBe("'-3");
    expect(summaryFileName("Level 1.pdf")).toBe("Level 1 summary.csv");
  });
});
