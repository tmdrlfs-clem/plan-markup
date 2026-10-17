import { describe, expect, it } from "vitest";
import { firstDifferences, normalizeSql } from "./check-schema-drift.mjs";

describe("normalizeSql", () => {
  it("drops SET and set_config lines, blank lines and trailing whitespace", () => {
    const sql = [
      "SET statement_timeout = 0;",
      "SELECT pg_catalog.set_config('search_path', '', false);",
      "",
      "CREATE TABLE a (id int);   ",
      "   ",
      "ALTER TABLE a ENABLE ROW LEVEL SECURITY;",
    ].join("\n");
    expect(normalizeSql(sql)).toBe("CREATE TABLE a (id int);\nALTER TABLE a ENABLE ROW LEVEL SECURITY;");
  });

  it("treats CRLF and LF input the same", () => {
    expect(normalizeSql("a;\r\nb;\r\n")).toBe(normalizeSql("a;\nb;\n"));
  });

  it("keeps SET inside a function body when indented", () => {
    expect(normalizeSql("    SET search_path = ''")).toBe("    SET search_path = ''");
  });
});

describe("firstDifferences", () => {
  it("is empty for equal input", () => {
    expect(firstDifferences("a\nb", "a\nb")).toEqual([]);
  });

  it("reports changed and missing lines", () => {
    expect(firstDifferences("a\nb", "a\nc\nd")).toEqual([
      "  line 2:",
      "  - committed: b",
      "  + database:  c",
      "  line 3:",
      "  - committed: (missing)",
      "  + database:  d",
    ]);
  });

  it("caps the number of reported differences", () => {
    expect(firstDifferences("a\nb\nc", "x\ny\nz", 2)).toHaveLength(6);
  });
});
