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
    "lets a clean oracle file pass (its own modules only)",
    async () => {
      const ids = await ruleIds("import { insideRing } from './kernel';\nexport const y = insideRing;\n", ORACLE);
      expect(ids).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "Story 9.4: refuses any oracle import outside its folder (design §4.1)",
    async () => {
      const ids = await ruleIds("import { ptToMm } from '@/core/geometry/units';\nexport const y = ptToMm;\n", ORACLE);
      expect(ids).toContain("no-restricted-imports");
    },
    TIMEOUT,
  );

  it(
    "Story 9.5: bans an oracle import in the placer",
    async () => {
      for (const spec of ["../oracle", "@/core/sprinkler/oracle/check"]) {
        const ids = await ruleIds(`import { x } from '${spec}';\nexport const y = x;\n`, "src/core/sprinkler/placer/__probe__.ts");
        expect(ids).toContain("no-restricted-imports");
      }
    },
    TIMEOUT,
  );

  it(
    "Story 9.5: lets a clean placer file pass (its own modules only)",
    async () => {
      const ids = await ruleIds("import { bbox } from './geometry';\nexport const y = bbox;\n", "src/core/sprinkler/placer/__probe__.ts");
      expect(ids).toEqual([]);
    },
    TIMEOUT,
  );

  it.each(["src/core/__probe__.ts", "src/features/__probe__.ts", "src/app/__probe__.tsx", "src/components/__probe__.tsx", "src/proxy.ts"])(
    "bans @sentry/* in %s",
    async (filePath) => {
      const ids = await ruleIds("import * as Sentry from '@sentry/nextjs';\nexport const y = Sentry;\n", filePath);
      expect(ids).toContain("no-restricted-imports");
    },
    TIMEOUT,
  );

  it.each(["src/lib/sentry/__probe__.ts", "src/instrumentation.ts", "src/instrumentation-client.ts"])(
    "allows @sentry/nextjs in %s",
    async (filePath) => {
      const ids = await ruleIds("import * as Sentry from '@sentry/nextjs';\nexport const y = Sentry;\n", filePath);
      expect(ids).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "keeps the @supabase/* ban in the UI-layer block",
    async () => {
      const ids = await ruleIds(
        "import { createBrowserClient } from '@supabase/ssr';\nexport const y = createBrowserClient;\n",
        "src/app/__probe__.tsx",
      );
      expect(ids).toContain("no-restricted-imports");
    },
    TIMEOUT,
  );
});
