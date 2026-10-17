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

const COMPONENT = "src/components/__probe__.tsx";
const TIMEOUT = 30_000;

describe("UI import lint rules are active (UX-DR4)", () => {
  it.each([
    "react-icons/fa",
    "@radix-ui/react-icons",
    "@heroicons/react/24/outline",
    "@tabler/icons-react",
    "@phosphor-icons/react",
    "@radix-ui/react-dialog",
  ])(
    "bans %s in src/components",
    async (source) => {
      const ids = await ruleIds(`import * as M from "${source}";\nexport const m = M;\n`, COMPONENT);
      expect(ids).toContain("no-restricted-imports");
    },
    TIMEOUT,
  );

  it(
    "allows lucide-react and radix-ui",
    async () => {
      const ids = await ruleIds(
        'import { X } from "lucide-react";\nimport { Dialog } from "radix-ui";\nexport const m = [X, Dialog];\n',
        COMPONENT,
      );
      expect(ids).toEqual([]);
    },
    TIMEOUT,
  );
});
