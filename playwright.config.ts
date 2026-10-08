import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/Features/PackageUpdates',
  testMatch: '**/responsive.spec.ts',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  reporter: 'list',
  outputDir: 'test-results/ui',
  use: { baseURL: 'http://127.0.0.1:4178', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run preview',
    env: { PORT: '4178' },
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
});
