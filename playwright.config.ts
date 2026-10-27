import { defineConfig, devices } from '@playwright/test';

const basePath = process.env.BASE_PATH ?? '/';
const port = 4173;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}${basePath}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx tsx scripts/dev/serve-dist.ts --base ${basePath} --port ${port}`,
        url: `http://localhost:${port}${basePath}`,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile-flow/ },
    { name: 'iphone', use: { ...devices['iPhone 13'] }, testMatch: /mobile-flow/ },
    { name: 'pixel', use: { ...devices['Pixel 7'] }, testMatch: /mobile-flow/ },
  ],
});
