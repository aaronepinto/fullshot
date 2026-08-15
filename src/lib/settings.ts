import type { Engine } from './types';

export interface Settings {
  engine: Engine;
  format: 'png' | 'jpeg' | 'webp';
  quality: number; // 0..1, used for jpeg/webp
  filenameTemplate: string;
  captureDelayMs: number;
  captureStartDelaySeconds: number; // countdown before every capture starts
  hideSticky: boolean;
  freezeAnimations: boolean;
  prescroll: boolean;
  afterCapture: 'editor' | 'download' | 'both';
  pdfPageMode: 'single' | 'a4' | 'letter';
  saveAs: boolean;
  maxCaptureHeight: number; // CSS px ceiling for full-page captures
  historyLimit: number;
}

export const DEFAULTS: Settings = {
  engine: 'stitch',
  format: 'png',
  quality: 0.92,
  filenameTemplate: '{domain} {date} {time}',
  captureDelayMs: 150,
  captureStartDelaySeconds: 0,
  hideSticky: true,
  freezeAnimations: true,
  prescroll: true,
  afterCapture: 'editor',
  pdfPageMode: 'single',
  saveAs: false,
  maxCaptureHeight: 40000,
  historyLimit: 30,
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get({ ...DEFAULTS });
  return { ...DEFAULTS, ...stored } as Settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}
