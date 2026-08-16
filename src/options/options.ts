import {
  debuggerAvailable,
  hasDebuggerPermission,
  requestDebuggerPermission,
} from '../lib/debugger-permission';
import { DEFAULTS, getSettings, saveSettings, type Settings } from '../lib/settings';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const FIELDS: (keyof Settings)[] = [
  'engine',
  'captureDelayMs',
  'captureStartDelaySeconds',
  'prescroll',
  'autoLoadMore',
  'hideSticky',
  'freezeAnimations',
  'maxCaptureHeight',
  'mobileCaptureWidth',
  'format',
  'quality',
  'filenameTemplate',
  'afterCapture',
  'pdfPageMode',
  'saveAs',
  'historyLimit',
];

let savedTimer: ReturnType<typeof setTimeout> | undefined;
function flashSaved() {
  const el = $('#saved');
  el.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    el.hidden = true;
  }, 1500);
}

/** The release that carries the debugger permission, for the builds that do not. */
const FULL_BUILD_URL = 'https://github.com/smollet-app/screencappy/releases/latest';

/**
 * Why Turbo is missing, in the two ways it can be.
 *
 * The Firefox build has no chrome.debugger to call. The store-fallback build runs on
 * a browser that does have it but ships without the permission declared, and telling
 * that user their browser cannot do it would be a plain lie, so the two cases are
 * told apart by what the running manifest actually asks for.
 */
function turboUnavailableReason(): string {
  const manifest = chrome.runtime.getManifest();
  const declared = (manifest.permissions ?? []).includes('debugger');
  const isFirefox = 'browser_specific_settings' in manifest;
  const sharedTail =
    ' The "Save as searchable PDF" and "Capture as mobile" context menu items need the same permission, so they are ' +
    'absent too. Everything else works exactly as it does elsewhere.';
  if (!declared && !isFirefox) {
    return (
      'Turbo is not in this build. It ships without the debugger permission, which some stores do not accept, so the ' +
      'one-shot capture engine is unavailable here.' +
      sharedTail +
      ' The build that includes Turbo is published at ' +
      FULL_BUILD_URL
    );
  }
  return (
    'Turbo is unavailable in this browser: it needs the DevTools debugger API, which only Chromium-based browsers ' +
    'provide.' + sharedTail
  );
}

async function updateTurboUi() {
  const engineEl = $<HTMLSelectElement>('#engine');
  if (!debuggerAvailable()) {
    engineEl.querySelector<HTMLOptionElement>('option[value="turbo"]')!.disabled = true;
    $('#turboHint').textContent = turboUnavailableReason();
    $('#grantDebugger').hidden = true;
    return;
  }
  // Chrome grants the permission at install, so the button is normally dead weight.
  // It is here for the case it was written for: a packaging where the permission is
  // missing and Turbo would otherwise fail with nothing on screen to fix it.
  const granted = await hasDebuggerPermission();
  $('#grantDebugger').hidden = granted;
}

async function load() {
  const settings = await getSettings();
  for (const key of FIELDS) {
    const el = document.getElementById(key) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      el.checked = Boolean(settings[key]);
    } else {
      el.value = String(settings[key]);
    }
  }
  $<HTMLOutputElement>('#qualityOut').value = `${Math.round(settings.quality * 100)}%`;
  await updateTurboUi();
}

for (const key of FIELDS) {
  const el = document.getElementById(key) as HTMLInputElement | HTMLSelectElement | null;
  if (!el) continue;
  el.addEventListener('change', async () => {
    let value: unknown;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      value = el.checked;
    } else if (typeof DEFAULTS[key] === 'number') {
      value = Number(el.value);
    } else {
      value = el.value;
    }
    await saveSettings({ [key]: value });
    if (key === 'quality') {
      $<HTMLOutputElement>('#qualityOut').value = `${Math.round(Number(el.value) * 100)}%`;
    }
    if (key === 'engine') {
      await updateTurboUi();
      // Requesting inside the change handler keeps the user-gesture requirement satisfied.
      if (el.value === 'turbo') {
        const granted = await requestDebuggerPermission();
        if (!granted) {
          await saveSettings({ engine: 'stitch' });
          (el as HTMLSelectElement).value = 'stitch';
        }
        await updateTurboUi();
      }
    }
    flashSaved();
  });
}

$('#grantDebugger').addEventListener('click', async () => {
  await requestDebuggerPermission();
  await updateTurboUi();
});

// The running build's own version, so what is installed can be checked against
// what the repository says shipped.
$('#version').textContent = `screencappy ${chrome.runtime.getManifest().version}`;

$('#editShortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

void load();
