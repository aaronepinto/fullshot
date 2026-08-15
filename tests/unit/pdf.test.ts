import { describe, expect, test } from 'bun:test';
import { buildPdf } from '../../src/lib/pdf';

const fakeJpeg = () =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]).buffer;

async function decode(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, text: new TextDecoder('latin1').decode(bytes) };
}

describe('buildPdf', () => {
  test('produces a structurally valid multi-page PDF', async () => {
    const { text } = await decode(
      buildPdf([
        { jpeg: fakeJpeg(), wPx: 800, hPx: 600 },
        { jpeg: fakeJpeg(), wPx: 800, hPx: 1200 },
      ])
    );
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  test('xref offsets point at their objects', async () => {
    const { text } = await decode(buildPdf([{ jpeg: fakeJpeg(), wPx: 100, hPx: 50 }]));
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n /gm)].map((m) =>
      Number(m[1])
    );
    expect(offsets.length).toBeGreaterThan(0);
    for (const [i, off] of offsets.entries()) {
      expect(text.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true);
    }
  });

  test('page size converts 96dpi pixels to PDF points', async () => {
    const { text } = await decode(buildPdf([{ jpeg: fakeJpeg(), wPx: 960, hPx: 480 }]));
    // 960px * 72/96 = 720pt, 480px -> 360pt
    expect(text).toContain('/MediaBox [0 0 720.00 360.00]');
  });
});
