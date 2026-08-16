import { describe, expect, test } from 'bun:test';
import { isBrowserUiUrl, isRestrictedUrl, isWebStoreUrl } from '../../src/lib/capture-common';

describe('isRestrictedUrl', () => {
  test('browser UI schemes are restricted', () => {
    expect(isRestrictedUrl('chrome://extensions/')).toBe(true);
    expect(isRestrictedUrl('chrome://settings/privacy')).toBe(true);
    expect(isRestrictedUrl('edge://extensions/')).toBe(true);
    expect(isRestrictedUrl('about:blank')).toBe(true);
    expect(isRestrictedUrl('devtools://devtools/bundled/devtools_app.html')).toBe(true);
    expect(isRestrictedUrl('chrome-extension://abcdef/editor.html')).toBe(true);
    expect(isRestrictedUrl('view-source:https://example.com/')).toBe(true);
  });

  test('an empty or missing url is restricted', () => {
    expect(isRestrictedUrl('')).toBe(true);
  });

  test('both Web Store hosts are restricted', () => {
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/x/abc')).toBe(true);
    expect(isRestrictedUrl('https://chrome.google.com/webstore/devconsole')).toBe(true);
  });

  test('the account-switcher /u/<n>/ prefix on the Web Store is restricted', () => {
    // The real URL that slipped through: a devconsole path behind /u/2/.
    expect(
      isRestrictedUrl(
        'https://chrome.google.com/u/2/webstore/devconsole/58928b4f-cf4a-4ed3-bb51-ffa59c7f842d/elgjglmkdbnlmplknkoanabdbaompefj/edit/distribution'
      )
    ).toBe(true);
    expect(isRestrictedUrl('https://chrome.google.com/u/0/webstore/')).toBe(true);
    expect(isRestrictedUrl('https://chrome.google.com/u/12/webstore/devconsole')).toBe(true);
  });

  test('the Web Store is probe-worthy, not a browser UI scheme', () => {
    // Browser UI schemes are hopeless everywhere; the Web Store differs per
    // Chromium fork, which is why the engine probes it instead of assuming.
    expect(isBrowserUiUrl('chrome://extensions/')).toBe(true);
    expect(isBrowserUiUrl('https://chrome.google.com/u/2/webstore/devconsole')).toBe(false);
    expect(isWebStoreUrl('https://chrome.google.com/u/2/webstore/devconsole')).toBe(true);
    expect(isWebStoreUrl('https://chromewebstore.google.com/detail/x/abc')).toBe(true);
    expect(isWebStoreUrl('chrome://extensions/')).toBe(false);
    expect(isWebStoreUrl('https://example.com/webstore')).toBe(false);
  });

  test('ordinary pages are not restricted', () => {
    expect(isRestrictedUrl('https://example.com/')).toBe(false);
    expect(isRestrictedUrl('https://chrome.google.com/intl/en/chrome/')).toBe(false);
    expect(isRestrictedUrl('https://google.com/u/2/webstore-lookalike')).toBe(false);
    expect(isRestrictedUrl('http://127.0.0.1:4173/fixture.html')).toBe(false);
  });
});
