import { describe, expect, test } from 'bun:test';
import { pdfFilename, renderFilename, sanitizeFilename } from '../../src/lib/filename';

const when = new Date(2026, 7, 15, 9, 5, 3); // Aug 15 2026, 09:05:03

describe('renderFilename', () => {
  test('substitutes all tokens', () => {
    const name = renderFilename('{domain} {date} {time} {mode}', {
      title: 'Hello World',
      url: 'https://www.example.com/some/page',
      mode: 'full',
      when,
    });
    expect(name).toBe('example.com 2026-08-15 09.05.03 full');
  });

  test('title token falls back to domain when the page has no title', () => {
    const name = renderFilename('{title}', {
      title: '',
      url: 'https://docs.github.com/x',
      mode: 'full',
      when,
    });
    expect(name).toBe('docs.github.com');
  });

  test('invalid URLs do not throw', () => {
    const name = renderFilename('{domain} {date}', { title: 't', url: 'not a url', mode: 'full', when });
    expect(name).toBe('page 2026-08-15');
  });

  test('unknown tokens are left alone, output is never empty', () => {
    expect(renderFilename('{nope}', { title: '', url: '', mode: 'full', when })).not.toBe('');
  });
});

describe('pdfFilename', () => {
  test('appends the pdf extension to the rendered template', () => {
    const name = pdfFilename('{domain} {date} {mode}', {
      title: 'Hello',
      url: 'https://www.example.com/page',
      mode: 'pdf',
      when,
    });
    expect(name).toBe('example.com 2026-08-15 pdf.pdf');
  });

  test('falls back to the default base name when the template renders empty', () => {
    expect(pdfFilename('', { title: '', url: '', mode: 'pdf', when })).toBe('screencappy.pdf');
  });
});

describe('sanitizeFilename', () => {
  test('strips path separators and reserved characters', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).not.toMatch(/[\\/:*?"<>|]/);
  });

  test('trims leading dots so downloads are never hidden files', () => {
    expect(sanitizeFilename('...secret')).toBe('secret');
  });

  test('caps length', () => {
    expect(sanitizeFilename('x'.repeat(500)).length).toBeLessThanOrEqual(180);
  });
});
