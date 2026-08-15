"use strict";
(() => {
  // src/lib/debugger-permission.ts
  function debuggerAvailable() {
    return typeof chrome.debugger !== "undefined";
  }
  async function hasDebuggerPermission() {
    if (!debuggerAvailable()) return false;
    try {
      return await chrome.permissions.contains({ permissions: ["debugger"] });
    } catch {
      return false;
    }
  }
  async function requestDebuggerPermission() {
    if (!debuggerAvailable()) return false;
    try {
      return await chrome.permissions.request({ permissions: ["debugger"] });
    } catch {
      return false;
    }
  }

  // src/lib/settings.ts
  var DEFAULTS = {
    engine: "stitch",
    format: "png",
    quality: 0.92,
    filenameTemplate: "{domain} {date} {time}",
    captureDelayMs: 150,
    captureStartDelaySeconds: 0,
    hideSticky: true,
    freezeAnimations: true,
    prescroll: true,
    autoLoadMore: false,
    afterCapture: "editor",
    pdfPageMode: "single",
    saveAs: false,
    maxCaptureHeight: 4e4,
    mobileCaptureWidth: 390,
    historyLimit: 30
  };
  async function getSettings() {
    const stored = await chrome.storage.sync.get({ ...DEFAULTS });
    return { ...DEFAULTS, ...stored };
  }
  async function saveSettings(patch) {
    await chrome.storage.sync.set(patch);
  }

  // src/options/options.ts
  var $ = (sel) => document.querySelector(sel);
  var FIELDS = [
    "engine",
    "captureDelayMs",
    "captureStartDelaySeconds",
    "prescroll",
    "autoLoadMore",
    "hideSticky",
    "freezeAnimations",
    "maxCaptureHeight",
    "mobileCaptureWidth",
    "format",
    "quality",
    "filenameTemplate",
    "afterCapture",
    "pdfPageMode",
    "saveAs",
    "historyLimit"
  ];
  var savedTimer;
  function flashSaved() {
    const el = $("#saved");
    el.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      el.hidden = true;
    }, 1500);
  }
  async function updateTurboUi() {
    const engineEl = $("#engine");
    if (!debuggerAvailable()) {
      engineEl.querySelector('option[value="turbo"]').disabled = true;
      $("#turboHint").textContent = "Turbo is unavailable in this browser: it needs the DevTools debugger API, which only Chromium-based browsers provide.";
      $("#grantDebugger").hidden = true;
      return;
    }
    const granted = await hasDebuggerPermission();
    $("#grantDebugger").hidden = engineEl.value !== "turbo" || granted;
  }
  async function load() {
    const settings = await getSettings();
    for (const key of FIELDS) {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        el.checked = Boolean(settings[key]);
      } else {
        el.value = String(settings[key]);
      }
    }
    $("#qualityOut").value = `${Math.round(settings.quality * 100)}%`;
    await updateTurboUi();
  }
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (!el) continue;
    el.addEventListener("change", async () => {
      let value;
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        value = el.checked;
      } else if (typeof DEFAULTS[key] === "number") {
        value = Number(el.value);
      } else {
        value = el.value;
      }
      await saveSettings({ [key]: value });
      if (key === "quality") {
        $("#qualityOut").value = `${Math.round(Number(el.value) * 100)}%`;
      }
      if (key === "engine") {
        await updateTurboUi();
        if (el.value === "turbo") {
          const granted = await requestDebuggerPermission();
          if (!granted) {
            await saveSettings({ engine: "stitch" });
            el.value = "stitch";
          }
          await updateTurboUi();
        }
      }
      flashSaved();
    });
  }
  $("#grantDebugger").addEventListener("click", async () => {
    await requestDebuggerPermission();
    await updateTurboUi();
  });
  $("#editShortcuts").addEventListener("click", (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });
  void load();
})();
