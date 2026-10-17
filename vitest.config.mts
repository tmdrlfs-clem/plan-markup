import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tools/**/*.test.ts",
      "scripts/**/*.test.{ts,mjs}",
    ],
    // Node by default (src/core stays DOM-free); DOM tests opt in per file with
    // a `// @vitest-environment jsdom` comment.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
