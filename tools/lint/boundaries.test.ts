import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: projectRoot });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((m) => m.severity === 2)
    .map((m) => m.ruleId ?? "parse-error");
}

const ORACLE = "src/core/sprinkler/oracle/__probe__.ts";
const TIMEOUT = 30_000;

describe("lint boundaries are active", () => {
  it(
    "bans a relative placer import in the oracle",
    async () => {
      const ids = await ruleIds("import { x } from '../placer/a';\nexport const y = x;\n", ORACLE);
      expect(ids).toContain("no-restricted-imports");
    },
    TIMEOUT,
  );

  it(
    "bans an @/ placer import in the oracle",
    async () => {
      const ids = await ruleIds(
        "import { x } from '@/core/sprinkler/placer/a';\nexport const y = x;\n",
        ORACLE,
      );
      expect(ids).toContain("no-restricted-imports");
    },
    TIMEOUT,
  );

  it(
    "keeps the core react ban inside the oracle block",
    async () => {
      const ids = await ruleIds(
        "import { useState } from 'react';\nexport const y = useState;\n",
        ORACLE,
      );
      expect(ids).toContain("no-restricted-imports");
    },
    TIMEOUT,
  );

  it(
    "bans react in src/core",
    async () => {
      const ids = await ruleIds(
        "import React from 'react';\nexport const y = React;\n",
        "src/core/geometry/__probe__.ts",
      );
      expect(ids).toContain("no-restricted-imports");
    },
    TIMEOUT,
  );

  it(
    "bans page-DOM globals in src/core",
    async () => {
      const ids = await ruleIds(
        "export const w = window;\n",
        "src/core/geometry/__probe__.ts",
      );
      expect(ids).toContain("no-restricted-globals");
    },
    TIMEOUT,
  );

  it(
    "bans console in src",
    async () => {
      const ids = await ruleIds("console.log(1);\n", "src/features/__probe__.ts");
      expect(ids).toContain("no-console");
    },
    TIMEOUT,
  );

  it(
    "lets a clean oracle file pass",
    async () => {
      const ids = await ruleIds(
        "import { ptToMm } from '@/core/geometry/units';\nexport const y = ptToMm;\n",
        ORACLE,
      );
      expect(ids).toEqual([]);
    },
    TIMEOUT,
  );
});
