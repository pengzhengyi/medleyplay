import { defineConfig, devices } from "@playwright/test";

import { SIGNED_IN, SIGNED_IN_TUBE, TUBE_URL } from "./e2e/fixtures";

// The tests drive the real server, serving the production build, over music that
// `e2e/serve.py` makes; the setup project signs in and scans it first. Adding music from
// Bilibili runs against a second server, `e2e/serve_tube.py`, whose Bilibili is a test
// plugin, so the Tracks it adds don't change what the other tests see.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Every test plays audio, and too many at once starve the audio clock.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // `on-first-retry` traces only a test that failed once, so a green run pays nothing.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /setup\.ts/ },
    {
      name: "chromium",
      testIgnore: /manual-downloads\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: SIGNED_IN },
      dependencies: ["setup"],
    },
    { name: "tube-setup", testMatch: /setup-tube\.ts/, use: { baseURL: TUBE_URL } },
    {
      name: "tube",
      testMatch: /manual-downloads\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: TUBE_URL, storageState: SIGNED_IN_TUBE },
      dependencies: ["tube-setup"],
    },
  ],
  webServer: [
    {
      command: "npm run build && uv run --project .. python e2e/serve.py",
      url: "http://127.0.0.1:4174/api/setup",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "uv run --project .. python e2e/serve_tube.py",
      url: `${TUBE_URL}/api/setup`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
