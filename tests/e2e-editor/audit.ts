/**
 * Shared machinery for the pre-launch UI sweep: a console watcher, a control
 * enumerator, colour maths, and the gallery path.
 *
 * The sweep asks the same three questions of every control on both pages, so the
 * questions live here once rather than in each spec. Nothing here knows about the
 * editor specifically: it walks whatever page it is handed.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Where the look-and-feel screenshots land. Overridable so a reviewer can point a
 * run at a scratch folder without the images ever touching the repo.
 */
export const GALLERY_DIR = process.env.UI_GALLERY_DIR ?? join(process.cwd(), 'test-results', 'ui-gallery');

export function shotPath(name: string): string {
  mkdirSync(GALLERY_DIR, { recursive: true });
  return join(GALLERY_DIR, `${name}.png`);
}

/**
 * Everything the page complained about while a spec drove it. Errors fail the
 * sweep; warnings are collected separately because a browser deprecation notice is
 * not the product's bug to answer for.
 */
export interface ConsoleWatch {
  errors: string[];
  warnings: string[];
}

export function watchConsole(page: Page): ConsoleWatch {
  const watch: ConsoleWatch = { errors: [], warnings: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') watch.errors.push(m.text());
    if (m.type() === 'warning') watch.warnings.push(m.text());
  });
  page.on('pageerror', (e) => watch.errors.push(`uncaught: ${e.message}`));
  page.on('requestfailed', (r) => watch.errors.push(`request failed: ${r.url()}`));
  return watch;
}

/**
 * Waits out the frame the editor renders on. Everything the toolbar reflects, the
 * pressed states included, is written from render(), so a snapshot taken in the same
 * tick as the click that caused it reads the state the click was meant to replace.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  );
}

/** One interactive thing on the page, as the sweep sees it. */
export interface Control {
  /** A selector that resolves to exactly this element. */
  sel: string;
  tag: string;
  /** Text, aria-label or title, in the order an assistive tech would take them. */
  name: string;
  title: string;
  ariaLabel: string;
  /** True when the only thing inside is an icon, so a tooltip is the whole label. */
  iconOnly: boolean;
  disabled: boolean;
  visible: boolean;
  focusable: boolean;
}

/**
 * Every control the page currently shows. Selectors are built from whatever is
 * unique about the element, so a failure names the control rather than its index.
 */
export async function enumerateControls(page: Page, root = 'body'): Promise<Control[]> {
  return page.evaluate((rootSel) => {
    const scope = document.querySelector(rootSel)!;
    const SELECTOR =
      'button, select, input, textarea, a[href], [role="button"], [tabindex]:not([tabindex="-1"])';

    /** A selector that picks out exactly this element, preferring stable hooks. */
    const describe = (el: Element): string => {
      if (el.id) return `#${el.id}`;
      const testid = (el as HTMLElement).dataset?.testid;
      if (testid) return `[data-testid="${testid}"]`;
      const tool = (el as HTMLElement).dataset?.tool;
      if (tool) return `[data-tool="${tool}"]`;
      const color = (el as HTMLElement).dataset?.color;
      if (color) return `[data-color="${color}"]`;
      const format = (el as HTMLElement).dataset?.format;
      if (format) return `[data-format="${format}"]`;
      const parent = el.parentElement;
      if (!parent) return el.tagName.toLowerCase();
      const peers = [...parent.children].filter((c) => c.tagName === el.tagName);
      const nth = peers.indexOf(el) + 1;
      return `${describe(parent)} > ${el.tagName.toLowerCase()}:nth-of-type(${nth})`;
    };

    const out = [];
    for (const el of scope.querySelectorAll<HTMLElement>(SELECTOR)) {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0.01 &&
        box.width > 0 &&
        box.height > 0;
      const title = el.getAttribute('title') ?? '';
      const ariaLabel = el.getAttribute('aria-label') ?? '';
      // A form control's name usually comes from its <label>, whether that label
      // wraps it or points at it, so the accessible name has to look there too.
      const labels = 'labels' in el ? ((el as HTMLInputElement).labels ?? []) : [];
      const labelled = [...labels].map((l) => (l.textContent ?? '').trim()).join(' ').trim();
      const text = (el.textContent ?? '').trim() || labelled;
      // An SVG-only button has no text of its own; an emoji glyph counts as text.
      const iconOnly = text.length === 0 && el.querySelector('svg') !== null;
      out.push({
        sel: describe(el),
        tag: el.tagName.toLowerCase(),
        name: ariaLabel || text || title,
        title,
        ariaLabel,
        iconOnly,
        disabled: 'disabled' in el && Boolean((el as HTMLButtonElement).disabled),
        visible,
        focusable: el.tabIndex >= 0 && !('disabled' in el && (el as HTMLButtonElement).disabled),
      });
    }
    return out;
  }, root);
}

/**
 * Walks the tab ring from the top of the document and reports which of the given
 * controls focus lands on, in order.
 *
 * The controls are tagged in the DOM first rather than described again on the way
 * past. Describing twice means two pieces of code have to agree on what to call an
 * element with no id, and when they disagree the answer is a control that looks
 * unreachable when it is merely unrecognised.
 */
export async function tabOrder(page: Page, controls: Control[], steps: number): Promise<string[]> {
  await page.evaluate((sels) => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-sweep]')) delete el.dataset.sweep;
    for (const sel of sels) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) el.dataset.sweep = sel;
    }
    (document.activeElement as HTMLElement | null)?.blur();
  }, controls.map((c) => c.sel));

  const seen: string[] = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return 'body';
        return el.dataset.sweep ?? `untagged:${el.tagName.toLowerCase()}`;
      })
    );
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export type RGB = [number, number, number];

/**
 * Every text run on the page with the colours it actually rendered in. Resolving
 * through a canvas rather than parsing the computed string is what makes this work
 * at all: the shell states its palette in oklch and color-mix, and neither returns
 * anything a regular expression can read.
 */
export interface TextSample {
  sel: string;
  text: string;
  size: number;
  weight: number;
  fg: RGB;
  bg: RGB;
}

export async function sampleText(page: Page): Promise<TextSample[]> {
  return page.evaluate(() => {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const g = probe.getContext('2d', { willReadFrequently: true })!;

    /** Any CSS colour, as premultiplied RGBA, by asking the renderer to paint it. */
    const resolve = (css: string): [number, number, number, number] => {
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = '#000';
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      const a = d[3]! / 255;
      // getImageData returns straight alpha over a cleared (transparent) pixel.
      return [d[0]!, d[1]!, d[2]!, a];
    };

    const over = (
      top: [number, number, number, number],
      bottom: [number, number, number]
    ): [number, number, number] => [
      Math.round(top[0] * top[3] + bottom[0] * (1 - top[3])),
      Math.round(top[1] * top[3] + bottom[1] * (1 - top[3])),
      Math.round(top[2] * top[3] + bottom[2] * (1 - top[3])),
    ];

    /** The colour behind an element: the first painted ancestor, composited down. */
    const backdrop = (el: Element): [number, number, number] => {
      const chain: [number, number, number, number][] = [];
      let node: Element | null = el;
      while (node) {
        const c = resolve(getComputedStyle(node).backgroundColor);
        if (c[3] > 0) {
          chain.unshift(c);
          if (c[3] >= 0.999) break;
        }
        node = node.parentElement;
      }
      // Nothing opaque anywhere up the tree means the browser's own white.
      let base: [number, number, number] = [255, 255, 255];
      for (const layer of chain) base = over(layer, base);
      return base;
    };

    const describe = (el: Element): string => {
      if (el.id) return `#${el.id}`;
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)[0];
      return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
    };

    const out = [];
    const seen = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Only elements that own their text, so a wrapper is not measured twice.
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      const fg = resolve(style.color);
      const bg = backdrop(el);
      const key = `${describe(el)}|${fg.join()}|${bg.join()}|${style.fontSize}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        sel: describe(el),
        text: own.slice(0, 60),
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight) || 400,
        fg: over(fg, bg),
        bg,
      });
    }
    return out;
  });
}

/**
 * The mean colour of a screenshot, decoded by the browser that took it. Used to
 * catch a light first paint: no image library is needed to answer "was this frame
 * white", and adding one for that would be a dependency this product does not carry.
 */
export async function meanColor(page: Page, png: Buffer): Promise<RGB> {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = c.getContext('2d')!;
    g.drawImage(bitmap, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0;
    let gr = 0;
    let bl = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!;
      gr += d[i + 1]!;
      bl += d[i + 2]!;
    }
    const n = d.length / 4;
    return [Math.round(r / n), Math.round(gr / n), Math.round(bl / n)] as [number, number, number];
  }, png.toString('base64'));
}

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([r, g, b]: RGB): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG's own definition of large text: 24px, or 18.66px when bold. */
export const isLargeText = (size: number, weight: number): boolean =>
  size >= 24 || (size >= 18.66 && weight >= 700);

export const aaFloor = (size: number, weight: number): number => (isLargeText(size, weight) ? 3 : 4.5);
