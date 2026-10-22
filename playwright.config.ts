import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // Needs the local Supabase stack (npm run db:start); clears rate-limit counters.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:3020", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // E2E_PROD=1 (CI) serves the production build (`npm run build` first): the real CSP,
  // minified chunks and the static pdf.js assets as deployed. Locally `next dev` by default.
  webServer: {
    command: process.env.E2E_PROD === "1" ? "npm run start" : "npm run dev",
    url: "http://localhost:3020",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
