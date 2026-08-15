/**
 * Shared harness for the editor UX suite: a chrome.* stub, an IndexedDB seed, and
 * image-space mouse helpers.
 *
 * Everything the editor paints lives on one canvas, so specs cannot locate targets
 * by role or text. Instead they drive the mouse to exact image coordinates through
 * the page's own transform (window.__screencappyTest.imageToClient), which keeps the
 * assertions readable and correct at any zoom or pan.
 */
import { expect, test as base, type Locator, type Page } from '@playwright/test';

export interface Anno {
  kind: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  text?: string;
  color?: string;
  size?: number;
  width?: number;
  fill?: boolean;
  char?: string;
  points?: number[];
}

export interface EditorState {
  tool: string;
  zoom: number;
  pan: { x: number; y: number };
  crop: { x: number; y: number; w: number; h: number } | null;
  selection: number[];
  editing: {
    mode: 'create' | 'edit';
    index: number;
    x: number;
    y: number;
    draft: string;
    color: string;
    size: number;
  } | null;
  annos: Anno[];
  undoDepth: number;
  redoDepth: number;
}

export type Point = [number, number];
export interface Mods {
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

const CAPTURE_W = 900;
const CAPTURE_H = 700;

/**
 * The complete chrome.* surface the editor page touches: settings on boot, the
 * options page button, and downloads on export. storage.sync.get resolves with the
 * defaults it was handed so a spec can override one setting by patching the result.
 */
async function stubChrome(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((overrides) => {
    const w = window as unknown as Record<string, unknown>;
    w.__downloads = [];
    w.__optionsOpened = 0;
    w.chrome = {
      storage: {
        sync: {
          get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...overrides }),
          set: async () => {},
        },
      },
      runtime: {
        openOptionsPage: () => {
          (w.__optionsOpened as number)++;
        },
        getURL: (p: string) => new URL(p, location.origin).href,
        id: 'test-extension-id',
      },
      downloads: {
        download: async (opts: unknown) => (w.__downloads as unknown[]).push(opts),
      },
    };
  }, settings);
}

/**
 * Writes one capture record plus one composed strip. loadBigImage takes the
 * strips-only fast path when status is 'composed', so this never exercises the
 * tile compositor, which is the capture suite's concern rather than this one's.
 */
async function seedCapture(page: Page, id: string): Promise<void> {
  await page.goto('/editor.html');
  await page.evaluate(
    async ({ id, w, h }) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('screencappy', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore('captures', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
          d.createObjectStore('tiles', { keyPath: 'key' }).createIndex('capId', 'capId');
          d.createObjectStore('strips', { keyPath: 'key' }).createIndex('capId', 'capId');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });

      const c = new OffscreenCanvas(w, h);
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      // Deterministic landmarks, so a pixel assertion has something to look at.
      g.fillStyle = '#1e293b';
      g.fillRect(40, 40, 200, 60);
      g.fillStyle = '#ef4444';
      g.fillRect(w - 120, h - 120, 80, 80);
      const blob = await c.convertToBlob({ type: 'image/png' });

      await new Promise<void>((res, rej) => {
        const t = db.transaction(['captures', 'strips'], 'readwrite');
        t.objectStore('captures').put({
          id,
          createdAt: Date.now(),
          mode: 'full',
          engine: 'stitch',
          title: 'Fixture capture',
          url: 'https://example.test/page',
          width: w,
          height: h,
          tileCount: 1,
          status: 'composed',
          truncated: false,
          clip: { x: 0, y: 0, w, h },
        });
        t.objectStore('strips').put({ key: `${id}:0`, capId: id, index: 0, y: 0, h, blob });
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
      });
    },
    { id, w: CAPTURE_W, h: CAPTURE_H }
  );
}

/** Image-space driver for the canvas, plus the state readback every spec asserts on. */
export class Editor {
  readonly width = CAPTURE_W;
  readonly height = CAPTURE_H;

  constructor(readonly page: Page) {}

  state(): Promise<EditorState> {
    return this.page.evaluate(
      () => (window as unknown as { __screencappyTest: { getState(): EditorState } }).__screencappyTest.getState()
    );
  }

  annos(): Promise<Anno[]> {
    return this.state().then((s) => s.annos);
  }

  /** Where an image-space point currently sits on screen. */
  at(x: number, y: number): Promise<{ x: number; y: number }> {
    return this.page.evaluate(
      (p) =>
        (window as unknown as { __screencappyTest: { imageToClient(x: number, y: number): { x: number; y: number } } })
          .__screencappyTest.imageToClient(p.x, p.y),
      { x, y }
    );
  }

  handles(index: number): Promise<{ id: string; x: number; y: number }[]> {
    return this.page.evaluate(
      (i) =>
        (window as unknown as { __screencappyTest: { handlesOf(i: number): { id: string; x: number; y: number }[] } })
          .__screencappyTest.handlesOf(i),
      index
    );
  }

  bounds(index: number): Promise<{ x: number; y: number; w: number; h: number } | null> {
    return this.page.evaluate(
      (i) =>
        (
          window as unknown as {
            __screencappyTest: { boundsOf(i: number): { x: number; y: number; w: number; h: number } | null };
          }
        ).__screencappyTest.boundsOf(i),
      index
    );
  }

  async tool(name: string): Promise<void> {
    await this.page.click(`[data-tool="${name}"]`);
  }

  async move(x: number, y: number): Promise<void> {
    const p = await this.at(x, y);
    await this.page.mouse.move(p.x, p.y);
  }

  async click(x: number, y: number, mods: Mods = {}): Promise<void> {
    const p = await this.at(x, y);
    await this.withMods(mods, async () => {
      await this.page.mouse.move(p.x, p.y);
      await this.page.mouse.down();
      await this.page.mouse.up();
    });
  }

  async dblclick(x: number, y: number): Promise<void> {
    const p = await this.at(x, y);
    await this.page.mouse.dblclick(p.x, p.y);
  }

  /**
   * A six-step drag. One jumbo move would fire a single pointermove, which hides
   * bugs in incremental delta accumulation, so the steps matter.
   */
  async drag(from: Point, to: Point, mods: Mods = {}): Promise<void> {
    const a = await this.at(...from);
    const b = await this.at(...to);
    await this.withMods(mods, async () => {
      await this.page.mouse.move(a.x, a.y);
      await this.page.mouse.down();
      await this.page.mouse.move(b.x, b.y, { steps: 6 });
      await this.page.mouse.up();
    });
  }

  /** Drag in screen pixels from an image-space origin, for handle work. */
  async dragBy(from: Point, dx: number, dy: number, mods: Mods = {}): Promise<void> {
    const a = await this.at(...from);
    await this.withMods(mods, async () => {
      await this.page.mouse.move(a.x, a.y);
      await this.page.mouse.down();
      await this.page.mouse.move(a.x + dx, a.y + dy, { steps: 6 });
      await this.page.mouse.up();
    });
  }

  private async withMods(mods: Mods, body: () => Promise<void>): Promise<void> {
    const keys = [mods.shift && 'Shift', mods.alt && 'Alt', mods.meta && 'ControlOrMeta'].filter(
      (k): k is string => typeof k === 'string'
    );
    for (const k of keys) await this.page.keyboard.down(k);
    try {
      await body();
    } finally {
      for (const k of keys.reverse()) await this.page.keyboard.up(k);
    }
  }

  /** Places a text label and commits it with Enter. */
  async writeText(x: number, y: number, text: string): Promise<void> {
    await this.tool('text');
    await this.click(x, y);
    await this.page.keyboard.type(text);
    await this.page.keyboard.press('Enter');
  }

  async setZoom(percent: number): Promise<void> {
    await this.page.click('#zoom100');
    while ((await this.state()).zoom < percent / 100 - 0.001) await this.page.click('#zoomIn');
    while ((await this.state()).zoom > percent / 100 + 0.001) await this.page.click('#zoomOut');
  }

  get textEditor(): Locator {
    return this.page.locator('[data-testid="text-editor"]');
  }

  get textInput(): Locator {
    return this.page.locator('[data-testid="text-input"]');
  }

  get toast(): Locator {
    return this.page.locator('#toast');
  }

  /**
   * True when any painted pixel in an image-space box is close to the given colour.
   * Sampling one pixel would land between glyph strokes as often as on one.
   */
  async paints(box: { x: number; y: number; w: number; h: number }, hex: string): Promise<boolean> {
    const a = await this.at(box.x, box.y);
    const b = await this.at(box.x + box.w, box.y + box.h);
    return this.page.evaluate(
      (arg) => {
        const c = document.querySelector('canvas')!;
        const r = c.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const x = Math.round((arg.a.x - r.left) * dpr);
        const y = Math.round((arg.a.y - r.top) * dpr);
        const w = Math.max(1, Math.round((arg.b.x - arg.a.x) * dpr));
        const h = Math.max(1, Math.round((arg.b.y - arg.a.y) * dpr));
        const data = c.getContext('2d')!.getImageData(x, y, w, h).data;
        const n = parseInt(arg.hex.slice(1), 16);
        const want = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        for (let i = 0; i < data.length; i += 4) {
          if (want.every((v, k) => Math.abs(data[i + k]! - v) < 40)) return true;
        }
        return false;
      },
      { a, b, hex }
    );
  }

  activeTestId(): Promise<string | null> {
    return this.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
  }
}

export const test = base.extend<{ editor: Editor }>({
  editor: async ({ page }, use, testInfo) => {
    const id = `fixture-${testInfo.testId}`;
    await stubChrome(page);
    await seedCapture(page, id);
    await page.goto(`/editor.html?id=${encodeURIComponent(id)}`);
    await expect(page.locator('#loading')).toBeHidden();
    const editor = new Editor(page);
    // A known zoom and pan, so every spec's image coordinates land in the same place.
    await page.click('#zoom100');
    await use(editor);
  },
});

export { expect };
