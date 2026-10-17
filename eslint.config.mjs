import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// src/core must stay framework-free (it also runs inside Web Workers).
const CORE_BANNED = {
  paths: [
    { name: "react", message: "src/core must stay framework-free." },
    { name: "react-dom", message: "src/core must stay framework-free." },
  ],
  patterns: [
    {
      group: [
        "react/*",
        "react-dom/*",
        "next",
        "next/*",
        "@supabase/*",
        "@/features/*",
        "@/components/*",
        "@/lib/*",
        "@/app/*",
        "@/workers/*",
      ],
      message:
        "src/core must stay framework-free and import nothing from app layers.",
    },
  ],
};

const PLACER_BAN = {
  group: [
    "**/placer",
    "**/placer/*",
    "@/core/sprinkler/placer",
    "@/core/sprinkler/placer/*",
  ],
  message: "The 4541 oracle must stay independent of the placer.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next, plus non-app folders.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "spikes/**",
    "_bmad/**",
    "_bmad-output/**",
    ".claude/**",
    "fixtures/**",
    "playwright-report/**",
    "test-results/**",
    "src/lib/db/types.gen.ts",
  ]),
  {
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts"],
    rules: { "no-console": "error" },
  },
  {
    files: ["src/lib/logger.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", CORE_BANNED],
      // Only page-DOM globals are banned; self, navigator, crypto, performance
      // and OffscreenCanvas stay allowed because core runs in Web Workers.
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "localStorage",
        "sessionStorage",
        "location",
      ],
    },
  },
  {
    // Flat config does not merge options for the same rule: repeat the core
    // restrictions here and add the placer ban.
    files: ["src/core/sprinkler/oracle/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: CORE_BANNED.paths,
          patterns: [...CORE_BANNED.patterns, PLACER_BAN],
        },
      ],
    },
  },
  {
    // Raw auth calls only inside src/lib/auth (NFR11).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/auth/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(getSession|getUser|getClaims)$/]",
          message:
            "Use getAuthUser()/getAuthState() from @/lib/auth. Raw Supabase auth calls are banned outside src/lib/auth (NFR11).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.value=/^(getSession|getUser|getClaims)$/]",
          message: "Use getAuthUser()/getAuthState() from @/lib/auth (NFR11).",
        },
      ],
    },
  },
  {
    // UI layers and the proxy never import Supabase directly; they go through src/lib.
    files: [
      "src/app/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/features/**/*.{ts,tsx}",
      "src/proxy.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@supabase/*"], message: "Use src/lib/supabase or src/lib/auth." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
