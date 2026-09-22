import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    browserName: 'firefox',
    trace: 'off',
  },
  projects: [
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
      },
    },
  ],
});
