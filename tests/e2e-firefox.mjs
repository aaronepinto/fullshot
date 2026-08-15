/**
 * End-to-end test for the Firefox build (dist-firefox), driven by
 * selenium-webdriver and geckodriver against a real release Firefox.
 *
 * It runs the same capture scenarios as the Chromium e2e, so this is a genuine
 * capture test and not just a load check. Three things get proven:
 *  1. Gecko's own add-on installer accepts the build. installAddon() is the same
 *     path about:debugging's "Load Temporary Add-on" takes, so a bad permission
 *     name, a wrong MV3 background shape or a missing gecko id fails here.
 *  2. The extension's pages and WebExtension APIs run under Gecko: the options
 *     page loads settings out of storage and takes the Firefox branch that
 *     disables Turbo, because there is no chrome.debugger in this browser.
 *  3. Scroll-and-stitch composes the full page, asserted against the shared
 *     expectations in tests/fixtures.mjs.
 *
 * Two things are worth knowing about how it gets there.
 *
 * Current Firefox refuses WebDriver navigation to privileged schemes, so
 * driver.get('moz-extension://…') fails and the chrome-context escape hatch is
 * blocked too (geckodriver rejects -remote-allow-system-access via capabilities).
 * The test therefore patches a copy of the build, exactly as the Chromium e2e
 * already does, and reaches the options page by a page-initiated navigation.
 *
 * The patched copy adds two keys and changes nothing else:
 *  - host_permissions, so the capture hook works without a user gesture, which
 *    automation cannot produce. The Chromium e2e patches the same key.
 *  - web_accessible_resources for options.html, so an ordinary http page is
 *    allowed to navigate to it and give WebDriver a foothold in the extension.
 *
 * From that options page the test reaches the background event page through
 * runtime.getBackgroundPage() and calls the same __screencappyStart hook the
 * Chromium e2e uses. The tab object has to be fetched through the background's
 * own chrome.tabs, because an object built in WebDriver's sandbox arrives in the
 * background compartment with its properties stripped, and capture then silently
 * degrades to a single visible-area shot.
 *
 * Usage: bun run e2e:firefox   (requires `bun run build:firefox` output in
 * dist-firefox/ and Firefox installed; override the binary with FIREFOX=/path)
 */
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { SCENARIOS, assertComposed, startFixtureServer } from './fixtures.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = `${ROOT}dist-firefox`;
const DIST_E2E = `${ROOT}dist-firefox-e2e`;
const ADDON_ID = 'screencappy@smollet.app';

// Firefox mints a random moz-extension origin per profile, which would leave the
// extension's pages unaddressable; pinning the mapping before the profile starts
// makes the URL predictable.
const ADDON_UUID = '4f4b2a7c-0d6e-4a19-9b30-5c2e8f1a7d64';
const OPTIONS_URL = `moz-extension://${ADDON_UUID}/options.html`;

function findFirefox() {
  const candidates = [
    process.env.FIREFOX,
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    '/usr/bin/firefox',
    '/snap/bin/firefox',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'Firefox not found - install Firefox or set FIREFOX=/path/to/firefox. ' +
        'There is no download fallback; this test needs a real Firefox.'
    );
  }
  return found;
}

async function patchBuild() {
  await rm(DIST_E2E, { recursive: true, force: true });
  await cp(DIST, DIST_E2E, { recursive: true });
  const manifest = JSON.parse(await readFile(`${DIST_E2E}/manifest.json`, 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  manifest.web_accessible_resources = [{ resources: ['options.html'], matches: ['<all_urls>'] }];
  await writeFile(`${DIST_E2E}/manifest.json`, JSON.stringify(manifest));
}

async function openOptionsPage(driver, fixtureBase) {
  await driver.get(`${fixtureBase}/`);
  await driver.executeScript('location.href = arguments[0];', OPTIONS_URL);
  await driver.wait(until.elementLocated(By.css('#engine')), 30000);
}

async function assertFirefoxOptionsUi(driver) {
  // options.ts fills the form from chrome.storage, so a settled engine value
  // means the storage round trip worked under Gecko.
  const engine = await driver.findElement(By.css('#engine'));
  await driver.wait(async () => (await engine.getAttribute('value')) !== '', 20000);
  const engineValue = await engine.getAttribute('value');

  // The Firefox branch of updateTurboUi(): no chrome.debugger here, so Turbo has
  // to be offered as disabled and the permission button has to stay hidden.
  const turbo = await driver.findElement(By.css('#engine option[value="turbo"]'));
  if ((await turbo.getAttribute('disabled')) === null) {
    throw new Error('Turbo is selectable in Firefox, but chrome.debugger does not exist there');
  }
  if ((await driver.findElement(By.css('#grantDebugger')).getAttribute('hidden')) === null) {
    throw new Error('#grantDebugger is visible in Firefox, but there is no debugger permission to grant');
  }

  console.log(`✓ [firefox] options page loaded settings (engine=${engineValue})`);
  console.log('✓ [firefox] Turbo correctly disabled: this browser has no chrome.debugger');
}

/** Drives one capture from the options page and returns the editor's window handle. */
async function startCapture(driver, url) {
  const before = new Set(await driver.getAllWindowHandles());

  const result = await driver.executeAsyncScript(
    `const fixtureUrl = arguments[0];
     const done = arguments[arguments.length - 1];
     (async () => {
       const background = await browser.runtime.getBackgroundPage();
       const opened = await browser.tabs.create({ url: fixtureUrl, active: true });
       for (let i = 0; i < 150; i++) {
         if ((await browser.tabs.get(opened.id)).status === 'complete') break;
         await new Promise((r) => setTimeout(r, 200));
       }
       // Fetch the tab through the background's own API so the object lives in
       // the background's compartment; see the note at the top of this file.
       const tab = await background.chrome.tabs.get(opened.id);
       await background.__screencappyStart(tab, 'full');
       done({ ok: true });
     })().catch((err) => done({ ok: false, err: String((err && err.stack) || err) }));`,
    url
  );
  if (!result.ok) throw new Error(`capture hook failed: ${result.err}`);

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (const handle of await driver.getAllWindowHandles()) {
      if (before.has(handle)) continue;
      await driver.switchTo().window(handle);
      if ((await driver.getCurrentUrl()).includes('editor.html')) return handle;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The editor tab never opened');
}

async function runScenario(driver, optionsHandle, fixtureBase, scenario) {
  const label = `firefox/${scenario.name}`;
  await driver.switchTo().window(optionsHandle);
  const editorHandle = await startCapture(driver, `${fixtureBase}${scenario.path}`);

  await driver.switchTo().window(editorHandle);
  await driver.wait(until.elementLocated(By.css('#loading[hidden]')), 180000);
  const dims = await driver.findElement(By.css('#statDims')).getText();
  console.log(`[${label}] editor reports:`, dims);
  const { w, h } = assertComposed(label, dims, scenario);
  console.log(`✓ [${label}] stitched to ${w}×${h}`);

  // Leave only the options page behind so the next scenario starts clean.
  for (const handle of await driver.getAllWindowHandles()) {
    if (handle === optionsHandle) continue;
    await driver.switchTo().window(handle);
    await driver.close();
  }
  await driver.switchTo().window(optionsHandle);
}

async function main() {
  if (!existsSync(`${DIST}/manifest.json`)) throw new Error('Run `bun run build:firefox` first.');
  await patchBuild();

  const fixtures = await startFixtureServer();
  const options = new firefox.Options()
    .setBinary(findFirefox())
    .addArguments('-headless', '--width=1200', '--height=800')
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: ADDON_UUID }));

  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  let failed = false;
  try {
    await driver.manage().setTimeouts({ script: 180000 });

    const installedId = await driver.installAddon(DIST_E2E, true);
    if (installedId !== ADDON_ID) {
      throw new Error(`Firefox installed the add-on as "${installedId}", expected "${ADDON_ID}"`);
    }
    console.log(`✓ [firefox] Gecko accepted the build as ${installedId}`);

    await openOptionsPage(driver, fixtures.base);
    await assertFirefoxOptionsUi(driver);

    const optionsHandle = await driver.getWindowHandle();
    for (const scenario of SCENARIOS) {
      await runScenario(driver, optionsHandle, fixtures.base, scenario);
    }
    console.log('✓ e2e passed (firefox)');
  } catch (err) {
    failed = true;
    console.error('✗ e2e failed (firefox):', err);
  } finally {
    await driver.quit();
    fixtures.close();
    await rm(DIST_E2E, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

await main();
