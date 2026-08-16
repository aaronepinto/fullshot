/**
 * Harness for the settings page, in the same shape as the editor's.
 *
 * The page is plain HTML too: it touches chrome.storage.sync, chrome.permissions,
 * chrome.tabs and the presence of chrome.debugger, and nothing else. The stub keeps
 * a real store rather than a fixed reply, so a spec can turn a control and then ask
 * what was actually written.
 */
import { expect, test as base, type Page } from '@playwright/test';

export interface OptionsStubs {
  /** Whether chrome.debugger exists, which is what gates the Turbo engine. */
  debugger?: boolean;
  /** Whether the debugger permission is already granted. */
  debuggerGranted?: boolean;
  /** Settings the page should boot with. */
  stored?: Record<string, unknown>;
}

declare global {
  interface Window {
    __stored: Record<string, unknown>;
    __tabs: string[];
  }
}

export async function stubOptionsChrome(page: Page, opts: OptionsStubs = {}): Promise<void> {
  await page.addInitScript((o) => {
    window.__stored = { ...((o.stored ?? {}) as Record<string, unknown>) };
    window.__tabs = [];
    const api: Record<string, unknown> = {
      storage: {
        sync: {
          get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...window.__stored }),
          set: async (patch: Record<string, unknown>) => {
            Object.assign(window.__stored, patch);
          },
        },
      },
      permissions: {
        contains: async () => o.debuggerGranted !== false,
        request: async () => o.debuggerGranted !== false,
      },
      tabs: {
        create: async (info: { url: string }) => {
          window.__tabs.push(info.url);
        },
      },
      runtime: { getURL: (p: string) => new URL(p, location.origin).href, id: 'test-extension-id' },
    };
    // Presence is the whole test: Turbo is offered only where the API exists.
    if (o.debugger !== false) api.debugger = { attach: async () => {}, detach: async () => {} };
    (window as unknown as Record<string, unknown>).chrome = api;
  }, opts);
}

/** What the page wrote to storage, as the settings module would have written it. */
export function storedSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({ ...window.__stored }));
}

/** Tabs the page asked the browser to open. */
export function openedTabs(page: Page): Promise<string[]> {
  return page.evaluate(() => [...window.__tabs]);
}

export const test = base.extend<{ options: Page }>({
  options: async ({ page }, use) => {
    await stubOptionsChrome(page);
    await page.goto('/options.html');
    await expect(page.locator('h1')).toBeVisible();
    await use(page);
  },
});

export { expect };
