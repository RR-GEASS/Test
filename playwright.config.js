import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chromium =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: "list",
  outputDir: ".artifacts/playwright",
  use: {
    baseURL: "http://127.0.0.1:5190",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    launchOptions: {
      ...(chromium ? { executablePath: chromium } : {}),
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/dev.mjs --host 127.0.0.1 --port 5190 --strictPort",
    url: "http://127.0.0.1:5190",
    reuseExistingServer: !process.env.CI,
    env: { SCI_API_PORT: "3012", SCI_DATA_DIR: ".artifacts/e2e-data" },
  },
});
