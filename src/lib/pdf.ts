/**
 * Minimal PDF writer: embeds pre-encoded JPEG pages (DCTDecode), one image per page.
 * Zero dependencies — enough PDF for pixel-perfect screenshot export.
 */
export interface PdfPage {
  jpeg: ArrayBuffer;
  /** Pixel dimensions of the JPEG. */
  wPx: number;
  hPx: number;
}

/** Converts pixels to PDF points assuming 96 px/inch (CSS pixel density). */
const toPt = (px: number) => (px * 72) / 96;

export function buildPdf(pages: PdfPage[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const beginObj = (num: number) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
  };

  // Object numbering: 1 catalog, 2 pages root, then per page i: [page, image, contents].
  const objCount = 2 + pages.length * 3;
  const pageObj = (i: number) => 3 + i * 3;

  push('%PDF-1.4\n%\xB5\xB6\n');

  beginObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  beginObj(2);
  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`);

  pages.forEach((page, i) => {
    const w = toPt(page.wPx).toFixed(2);
    const h = toPt(page.hPx).toFixed(2);
    const imgNum = pageObj(i) + 1;
    const contentNum = pageObj(i) + 2;

    beginObj(pageObj(i));
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${imgNum} 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`
    );

    const jpeg = new Uint8Array(page.jpeg);
    beginObj(imgNum);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.wPx} /Height ${page.hPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
    );
    push(jpeg);
    push('\nendstream\nendobj\n');

    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    beginObj(contentNum);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  const xrefStart = length;
  push(`xref\n0 ${objCount + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= objCount; n++) {
    push(`${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
