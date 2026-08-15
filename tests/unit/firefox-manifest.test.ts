import { describe, expect, test } from 'bun:test';
// @ts-expect-error plain build-time JS module without type declarations
import { toFirefoxManifest } from '../../scripts/firefox-manifest.mjs';

const chromeManifest = {
  manifest_version: 3,
  name: 'Screencappy',
  version: '0.1.0',
  minimum_chrome_version: '116',
  offline_enabled: true,
  background: { service_worker: 'background.js' },
  permissions: ['activeTab', 'scripting'],
  optional_permissions: ['debugger'],
};

describe('toFirefoxManifest', () => {
  test('swaps the service worker for background scripts', () => {
    const out = toFirefoxManifest(chromeManifest);
    expect(out.background).toEqual({ scripts: ['background.js'] });
  });

  test('drops Chrome-only keys and the debugger permission', () => {
    const out = toFirefoxManifest(chromeManifest);
    expect(out.minimum_chrome_version).toBeUndefined();
    expect(out.offline_enabled).toBeUndefined();
    expect(out.optional_permissions).toBeUndefined();
  });

  test('keeps non-debugger optional permissions', () => {
    const out = toFirefoxManifest({
      ...chromeManifest,
      optional_permissions: ['debugger', 'tabs'],
    });
    expect(out.optional_permissions).toEqual(['tabs']);
  });

  test('adds gecko settings and preserves the rest', () => {
    const out = toFirefoxManifest(chromeManifest);
    expect(out.browser_specific_settings).toEqual({
      gecko: { id: 'screencappy@smollet.app', strict_min_version: '128.0' },
    });
    expect(out.permissions).toEqual(['activeTab', 'scripting']);
    expect(out.version).toBe('0.1.0');
  });

  test('does not mutate the input manifest', () => {
    const input = structuredClone(chromeManifest);
    toFirefoxManifest(input);
    expect(input).toEqual(chromeManifest);
  });
});
