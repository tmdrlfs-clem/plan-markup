import { describe, expect, it } from "vitest";
import { findForbiddenEnvFiles } from "./check-env-files.mjs";

describe("findForbiddenEnvFiles", () => {
  it("allows .env.example at any depth", () => {
    expect(findForbiddenEnvFiles([".env.example", "apps/x/.env.example", "src/a.ts"])).toEqual([]);
  });

  it("flags .env variants", () => {
    const paths = [".env", ".env.local", "sub/.env.production", ".env.test.local", "src/a.ts"];
    expect(findForbiddenEnvFiles(paths)).toEqual([
      ".env",
      ".env.local",
      "sub/.env.production",
      ".env.test.local",
    ]);
  });

  it("does not flag names that merely contain env", () => {
    expect(findForbiddenEnvFiles(["src/env.ts", "docs/dotenv.md"])).toEqual([]);
  });
});
