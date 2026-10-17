import { describe, expect, it } from "vitest";
import { findUnexpectedStaticRoutes, STATIC_ROUTE_ALLOWLIST } from "./check-dynamic-routes.mjs";

const manifest = (keys) => ({
  version: 4,
  routes: Object.fromEntries(keys.map((k) => [k, { initialRevalidateSeconds: false }])),
  dynamicRoutes: {},
});

describe("findUnexpectedStaticRoutes", () => {
  it("passes a clean manifest", () => {
    expect(findUnexpectedStaticRoutes(manifest([]), STATIC_ROUTE_ALLOWLIST)).toEqual([]);
  });

  it("passes allowlisted entries", () => {
    expect(findUnexpectedStaticRoutes(manifest(["/_global-error", "/favicon.ico"]), STATIC_ROUTE_ALLOWLIST)).toEqual([]);
  });

  it("names an offending static page", () => {
    expect(
      findUnexpectedStaticRoutes(manifest(["/favicon.ico", "/sign-in", "/"]), STATIC_ROUTE_ALLOWLIST),
    ).toEqual(["/", "/sign-in"]);
  });

  it("never allowlists the app pages", () => {
    for (const route of ["/", "/sign-in", "/workspace", "/_not-found"]) {
      expect(STATIC_ROUTE_ALLOWLIST).not.toContain(route);
    }
  });

  it("throws on a manifest without routes", () => {
    expect(() => findUnexpectedStaticRoutes({}, [])).toThrow(/routes/);
    expect(() => findUnexpectedStaticRoutes(null, [])).toThrow(/routes/);
  });
});
