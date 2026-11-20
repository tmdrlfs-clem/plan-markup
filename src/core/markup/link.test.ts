import { describe, expect, it } from "vitest";

import { isLink, normalizeLink } from "./link";

describe("link markup addresses", () => {
  it("keeps web and mail links, adding https:// or mailto: when left out", () => {
    expect(normalizeLink("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeLink("www.example.com")).toBe("https://www.example.com/");
    expect(normalizeLink("kim@example.com")).toBe("mailto:kim@example.com");
    expect(isLink("https://example.com/")).toBe(true);
  });

  it("refuses script, files and nonsense", () => {
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("file:///c:/x")).toBeNull();
    expect(normalizeLink("data:text/html,hi")).toBeNull();
    expect(normalizeLink("not a link")).toBeNull();
    expect(normalizeLink("foo")).toBeNull();
    expect(isLink("www.example.com")).toBe(false);
  });
});
