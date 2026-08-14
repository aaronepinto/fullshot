import type { CaptureMode, CaptureRecord, Engine, Rect } from './types';

export function newCaptureId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeRecord(opts: {
  id: string;
  mode: CaptureMode;
  engine: Engine;
  title: string;
  url: string;
  tileCount: number;
  truncated: boolean;
  clip: Rect;
}): CaptureRecord {
  return {
    id: opts.id,
    createdAt: Date.now(),
    mode: opts.mode,
    engine: opts.engine,
    title: opts.title,
    url: opts.url,
    width: 0,
    height: 0,
    tileCount: opts.tileCount,
    status: 'tiles',
    truncated: opts.truncated,
    clip: opts.clip,
  };
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export function base64ToBlob(base64: string, type: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
