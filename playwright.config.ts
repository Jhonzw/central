import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:17880',
    storageState: '.e2e/session.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node e2e/servidor.ts',
    url: 'http://localhost:17880/api/sessao',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
