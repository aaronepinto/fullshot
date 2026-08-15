/**
 * Playwright drives the annotation UX suite (tests/e2e-editor) against the built
 * editor page served over HTTP. The capture pipeline keeps its own puppeteer
 * harness (tests/e2e.mjs): that one needs a real unpacked extension, this one
 * does not.
 *
 * Runs on the system Chrome, discovered the same way tests/e2e.mjs does, so no
 * `playwright install` download is needed.
 */
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

function findChrome(): string {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  if (process.env.CHROME) candidates.unshift(process.env.CHROME);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found - set CHROME=/path/to/chrome');
  return found;
}

const PORT = Number(process.env.UX_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e-editor',
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
        launchOptions: {
          executablePath: findChrome(),
          args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
        },
      },
    },
  ],
  webServer: {
    command: 'node tests/e2e-editor/serve.mjs',
    url: `http://127.0.0.1:${PORT}/editor.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
