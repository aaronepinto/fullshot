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
  'hugePageAction',
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

async function updateTurboUi() {
  const engineEl = $<HTMLSelectElement>('#engine');
  if (!debuggerAvailable()) {
    // Firefox has no chrome.debugger, so Turbo can never work there.
    engineEl.querySelector<HTMLOptionElement>('option[value="turbo"]')!.disabled = true;
    $('#turboHint').textContent =
      'Turbo is unavailable in this browser: it needs the DevTools debugger API, which only Chromium-based browsers provide.';
    $('#grantDebugger').hidden = true;
    return;
  }
  const granted = await hasDebuggerPermission();
  $('#grantDebugger').hidden = true;
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

$('#editShortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

void load();
