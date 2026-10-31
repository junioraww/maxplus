import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30000,
  webServer: {
    command: "bun x svelte-kit sync && bun run dev --port 5173",
    port: 5173,
    reuseExistingServer: true,
  },
  use: {
    browserName: "firefox",
    baseURL: "http://localhost:5173",
    trace: "off",
  },
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "firefox",
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile",
      use: {
        browserName: "firefox",
        viewport: { width: 375, height: 667 },
        isMobile: true,
      },
    },
  ],
});
