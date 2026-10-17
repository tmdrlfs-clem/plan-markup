import { describe, expect, it } from "vitest";
import { findRlsOffenders } from "./check-rls.mjs";

describe("findRlsOffenders", () => {
  it("returns nothing when every table has RLS and a policy", () => {
    const rows = [{ schema: "public", table: "profiles", rls_enabled: true, policy_count: 2 }];
    expect(findRlsOffenders(rows)).toEqual({ noRls: [], noPolicy: [] });
  });

  it("returns nothing for an empty schema", () => {
    expect(findRlsOffenders([])).toEqual({ noRls: [], noPolicy: [] });
  });

  it("flags tables without RLS and tables without policies by qualified name", () => {
    const rows = [
      { schema: "public", table: "ok", rls_enabled: true, policy_count: 1 },
      { schema: "public", table: "open", rls_enabled: false, policy_count: 0 },
      { schema: "app", table: "locked", rls_enabled: true, policy_count: 0 },
      { schema: "public", table: "policy_but_off", rls_enabled: false, policy_count: 3 },
    ];
    expect(findRlsOffenders(rows)).toEqual({
      noRls: ["public.open", "public.policy_but_off"],
      noPolicy: ["public.open", "app.locked"],
    });
  });

  it("treats a string policy count from the driver as a number", () => {
    const rows = [
      { schema: "public", table: "a", rls_enabled: true, policy_count: "0" },
      { schema: "public", table: "b", rls_enabled: true, policy_count: "1" },
    ];
    expect(findRlsOffenders(rows).noPolicy).toEqual(["public.a"]);
  });
});
