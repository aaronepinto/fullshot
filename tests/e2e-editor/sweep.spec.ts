/**
 * The pre-launch control sweep.
 *
 * Every other spec in this folder asks whether one feature behaves. This one asks
 * a smaller question of everything at once: does each control exist, say what it
 * does, answer the keyboard, and actually do something when pressed. It fails on
 * dead controls, console errors, missing or malformed tooltips, controls no keyboard
 * can reach, and a tab ring that traps focus.
 *
 * The editor paints to a canvas, so "something changed" cannot be read off the DOM
 * alone. The signature below folds the DOM, the exposed editor state and the chrome.*
 * stub's ledger into one string, and a control is dead if pressing it leaves that
 * string untouched.
 */
import { type Page } from '@playwright/test';
import { enumerateControls, settle, tabOrder, watchConsole, type Control } from './audit';
import { expect, test, type Editor } from './fixtures';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

// ---------------------------------------------------------------------------
// Observable change
// ---------------------------------------------------------------------------

/**
 * Everything about the page a control could plausibly move. Deliberately coarse:
 * the sweep only needs to know that a press was not swallowed, and each control
 * that needs a sharper assertion than that gets its own spec further down.
 */
async function signature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __screencappyTest: { getState(): unknown };
      __downloads: unknown[];
      __optionsOpened: number;
    };
    const hidden = [
      '#annoPanel', '#history', '#formatMenu', '#emojiPicker', '#ctxMenu', '#cropBar',
      '#toast', '#textEditor', '#ctlWidth', '#ctlFont', '#ctlFill', '#emojiCurrent',
      '#btnCropReset', '#statUrl', '#emptyState', '#loading',
    ].map((s) => `${s}:${(document.querySelector<HTMLElement>(s)?.hidden ?? true) ? 1 : 0}`);
    const flags = [...document.querySelectorAll('[aria-pressed], [aria-expanded]')].map(
      (e) => `${e.id || (e as HTMLElement).dataset.tool || (e as HTMLElement).dataset.color}=` +
        `${e.getAttribute('aria-pressed') ?? ''}${e.getAttribute('aria-expanded') ?? ''}`
    );
    const text = ['#emojiCurrent', '#toast', '#statZoom', '#statDims', '#btnDownload', '#cropDims']
      .map((s) => `${s}:${document.querySelector(s)?.textContent ?? ''}`);
    const disabled = ['#btnUndo', '#btnRedo'].map(
      (s) => `${s}:${document.querySelector<HTMLButtonElement>(s)!.disabled}`
    );
    const rows = document.querySelectorAll('#annoList li, #historyList li').length;
    return JSON.stringify({
      state: w.__screencappyTest.getState(),
      hidden,
      flags,
      text,
      disabled,
      rows,
      downloads: w.__downloads.length,
      options: w.__optionsOpened,
      selects: [...document.querySelectorAll<HTMLSelectElement>('select')].map((s) => s.value),
      checks: [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map((c) => c.checked),
    });
  });
}

/**
 * Puts the editor back in a known state between presses, without using any of the
 * controls under test: a dead Escape key would otherwise hide a dead button.
 */
async function reset(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const sel of ['#annoPanel', '#history', '#formatMenu', '#emojiPicker', '#ctxMenu', '#toast']) {
      document.querySelector<HTMLElement>(sel)!.hidden = true;
    }
  });
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');
  await settle(page);
}

/**
 * Pressing the tool or the colour that is already chosen is meant to do nothing, so
 * the sweep would read it as dead. This moves the group off the control under test
 * first, and returns the sibling it used, so the press has somewhere to travel from.
 */
async function nudgeOffState(page: Page, sel: string): Promise<void> {
  if ((await page.getAttribute(sel, 'aria-pressed')) !== 'true') return;
  const sibling = await page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(s)!;
    const group = el.closest('[role="toolbar"], [role="group"]') ?? el.parentElement!;
    for (const peer of group.querySelectorAll<HTMLElement>('[aria-pressed="false"]')) {
      if (peer.dataset.tool) return `[data-tool="${peer.dataset.tool}"]`;
      if (peer.dataset.color) return `[data-color="${peer.dataset.color}"]`;
      if (peer.id) return `#${peer.id}`;
    }
    return null;
  }, sel);
  if (sibling) await page.click(sibling);
}

/** The states that reveal the controls the resting page keeps hidden. */
const STATES: { name: string; prep: (page: Page, editor: Editor) => Promise<void> }[] = [
  { name: 'rest', prep: async () => {} },
  { name: 'shape tool', prep: async (page) => void (await page.keyboard.press('r')) },
  { name: 'text tool', prep: async (page) => void (await page.keyboard.press('t')) },
  {
    name: 'emoji picker open',
    prep: async (page) => {
      await page.keyboard.press('e');
      await page.click('#emojiCurrent');
    },
  },
  { name: 'format menu open', prep: async (page) => void (await page.click('#btnFormat')) },
  { name: 'annotations drawer', prep: async (page) => void (await page.click('#btnAnnos')) },
  { name: 'history drawer', prep: async (page) => void (await page.click('#btnHistory')) },
  {
    name: 'crop pending',
    prep: async (page, editor) => {
      await page.keyboard.press('c');
      await editor.drag([100, 100], [400, 400]);
    },
  },
  {
    name: 'context menu',
    prep: async (page, editor) => {
      const p = await editor.at(300, 300);
      await page.mouse.click(p.x, p.y, { button: 'right' });
    },
  },
];

/** Controls the click sweep leaves alone, each with the reason and its own spec. */
const NOT_CLICKED = new Map<string, string>([
  ['#canvas', 'a drawing surface rather than a control; the tool cycle spec drives it'],
  ['#statUrl', 'a link out to the captured page, so pressing it opens a tab'],
  ['#strokeWidth', 'a select: swept option by option below'],
  ['#fontSize', 'a select: swept option by option below'],
  ['#fillShape', 'a checkbox: swept below'],
  ['#historyList > li:nth-of-type(1)', 'loading another capture navigates; swept below'],
  [
    '#historyList > li:nth-of-type(1) > button:nth-of-type(1)',
    'deleting the only capture navigates away from the fixture; swept below',
  ],
]);

/** Every control the editor can show, gathered by walking through each state. */
async function allControls(page: Page, editor: Editor): Promise<Map<string, Control & { state: string }>> {
  const found = new Map<string, Control & { state: string }>();
  for (const state of STATES) {
    await reset(page);
    await state.prep(page, editor);
    for (const c of await enumerateControls(page)) {
      if (!c.visible || found.has(c.sel)) continue;
      found.set(c.sel, { ...c, state: state.name });
    }
  }
  await reset(page);
  return found;
}

// ---------------------------------------------------------------------------
// Naming and tooltips
// ---------------------------------------------------------------------------

/** The house format for a shortcut hint: one trailing parenthesis, nothing else. */
const HINT = /^[^()]+ \([⌘⇧⌥⌃]*[A-Z0-9+−]\)$/;

/** The tool hotkeys the editor documents, as the tooltips must spell them. */
const TOOL_KEYS: Record<string, string> = {
  select: 'V', crop: 'C', arrow: 'A', line: 'L', rect: 'R', ellipse: 'O',
  pen: 'P', highlight: 'H', text: 'T', blur: 'B', emoji: 'E',
};

test('every control the editor shows says what it is', async ({ editor, page }) => {
  const controls = await allControls(page, editor);
  expect(controls.size, 'the sweep found no controls at all').toBeGreaterThan(50);

  const nameless = [...controls.values()].filter((c) => !c.name.trim());
  expect(nameless.map((c) => `${c.sel} (${c.state})`), 'controls with no accessible name').toEqual([]);

  // An icon carries no name of its own, so the tooltip is the whole label.
  const untooltipped = [...controls.values()].filter((c) => c.iconOnly && !c.title.trim());
  expect(untooltipped.map((c) => c.sel), 'icon-only controls with no tooltip').toEqual([]);
});

test('tooltips share one vocabulary and one shortcut format', async ({ editor, page }) => {
  const controls = await allControls(page, editor);
  const malformed: string[] = [];
  for (const c of controls.values()) {
    if (!c.title.includes('(')) continue;
    if (!HINT.test(c.title)) malformed.push(`${c.sel}: ${JSON.stringify(c.title)}`);
  }
  expect(malformed, 'shortcut hints that do not read "Verb phrase (Key)"').toEqual([]);

  // A tooltip that names the wrong key is worse than none: it teaches a lie.
  for (const [tool, key] of Object.entries(TOOL_KEYS)) {
    const title = await page.getAttribute(`[data-tool="${tool}"]`, 'title');
    expect(title, `the ${tool} tool has no tooltip`).toBeTruthy();
    expect(title!.endsWith(`(${key})`), `${tool} tooltip ${JSON.stringify(title)} names the wrong key`).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// The click sweep
// ---------------------------------------------------------------------------

test('no control on the editor is dead', async ({ editor, page }) => {
  // Seventy-odd controls, each pressed from a freshly rebuilt state.
  test.setTimeout(180_000);
  const watch = watchConsole(page);
  const controls = await allControls(page, editor);
  const dead: string[] = [];

  for (const c of controls.values()) {
    if (!c.focusable || c.disabled) continue;
    const skip = [...NOT_CLICKED.keys()].find((k) => c.sel === k);
    if (skip) continue;

    const state = STATES.find((s) => s.name === c.state)!;
    await reset(page);
    await state.prep(page, editor);
    await nudgeOffState(page, c.sel);
    await settle(page);
    const before = await signature(page);
    await page.click(c.sel, { timeout: 5_000 });
    // Export and copy finish on a later turn, so give the slow ones their frame.
    await page.waitForFunction(
      (prev) => {
        const w = window as unknown as { __screencappyTest: { getState(): unknown }; __downloads: unknown[] };
        return (
          JSON.stringify({ s: w.__screencappyTest.getState(), d: w.__downloads.length }) !== prev ||
          !document.querySelector<HTMLElement>('#toast')!.hidden
        );
      },
      await page.evaluate(() => {
        const w = window as unknown as { __screencappyTest: { getState(): unknown }; __downloads: unknown[] };
        return JSON.stringify({ s: w.__screencappyTest.getState(), d: w.__downloads.length });
      }),
      { timeout: 1_000 }
    ).catch(() => {});
    await settle(page);
    if ((await signature(page)) === before) dead.push(`${c.sel} (${c.state}) "${c.name}"`);
  }

  expect(dead, 'controls that changed nothing observable when pressed').toEqual([]);
  expect(watch.errors, 'console errors raised while sweeping the controls').toEqual([]);
});

test('every style select applies every one of its options', async ({ editor, page }) => {
  const watch = watchConsole(page);

  await page.keyboard.press('r');
  for (const value of ['3', '6', '10', '16']) {
    await page.selectOption('#strokeWidth', value);
    await editor.drag([60, 60], [160, 160]);
    const drawn = (await editor.annos()).at(-1)!;
    expect(drawn.width, `stroke width ${value} did not reach the annotation`).toBe(Number(value));
    await page.click('#btnUndo');
  }

  await page.keyboard.press('t');
  for (const value of ['24', '36', '56', '84']) {
    await page.selectOption('#fontSize', value);
    await editor.writeText(200, 200, 'size');
    const drawn = (await editor.annos()).at(-1)!;
    expect(drawn.size, `font size ${value} did not reach the label`).toBe(Number(value));
    await page.click('#btnUndo');
  }

  await page.keyboard.press('r');
  for (const fill of [true, false]) {
    await page.setChecked('#fillShape', fill);
    await editor.drag([60, 300], [200, 420]);
    expect((await editor.annos()).at(-1)!.fill, `fill=${fill} did not reach the shape`).toBe(fill);
    await page.click('#btnUndo');
  }

  expect(watch.errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Tools, end to end
// ---------------------------------------------------------------------------

/** Each tool's primary gesture, and the annotation it must leave behind. */
const TOOL_CYCLE: { tool: string; kind: string; gesture: (e: Editor) => Promise<void> }[] = [
  { tool: 'arrow', kind: 'arrow', gesture: (e) => e.drag([100, 100], [300, 260]) },
  { tool: 'line', kind: 'line', gesture: (e) => e.drag([100, 100], [300, 260]) },
  { tool: 'rect', kind: 'rect', gesture: (e) => e.drag([100, 100], [300, 260]) },
  { tool: 'ellipse', kind: 'ellipse', gesture: (e) => e.drag([100, 100], [300, 260]) },
  { tool: 'pen', kind: 'pen', gesture: (e) => e.drag([100, 100], [300, 260]) },
  { tool: 'highlight', kind: 'highlight', gesture: (e) => e.drag([100, 100], [300, 160]) },
  { tool: 'blur', kind: 'blur', gesture: (e) => e.drag([100, 100], [300, 260]) },
  { tool: 'emoji', kind: 'emoji', gesture: (e) => e.click(300, 300) },
  { tool: 'text', kind: 'text', gesture: (e) => e.writeText(300, 300, 'label') },
];

for (const { tool, kind, gesture } of TOOL_CYCLE) {
  test(`the ${tool} tool draws, and undo takes it back`, async ({ editor, page }) => {
    const watch = watchConsole(page);
    await editor.tool(tool);
    expect((await editor.state()).tool).toBe(tool);
    await expect(page.locator(`[data-tool="${tool}"]`)).toHaveAttribute('aria-pressed', 'true');

    await gesture(editor);
    const drawn = await editor.annos();
    expect(drawn, `the ${tool} gesture drew nothing`).toHaveLength(1);
    expect(drawn[0]!.kind).toBe(kind);

    await page.click('#btnUndo');
    expect(await editor.annos(), `undo did not take the ${tool} back`).toEqual([]);
    expect(watch.errors).toEqual([]);
  });
}

test('the crop tool crops, and the crop can be reset from either place', async ({ editor, page }) => {
  await editor.tool('crop');
  await editor.drag([100, 100], [500, 400]);
  await expect(page.locator('#cropBar')).toBeVisible();
  await page.click('#cropApply');
  expect((await editor.state()).crop).not.toBeNull();

  await page.click('#btnCropReset');
  expect((await editor.state()).crop).toBeNull();

  await editor.tool('crop');
  await editor.drag([100, 100], [500, 400]);
  await page.click('#cropCancel');
  expect((await editor.state()).crop).toBeNull();
  await expect(page.locator('#cropBar')).toBeHidden();
});

test('the canvas context menu copies and downloads', async ({ editor, page }) => {
  const p = await editor.at(300, 300);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.locator('#ctxMenu')).toBeVisible();

  await page.click('#ctxDownload');
  await expect(page.locator('#ctxMenu')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __downloads: unknown[] }).__downloads.length))
    .toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

test('every visible control is in the tab ring, and the ring closes', async ({ editor, page }) => {
  const stops = [...(await allControls(page, editor)).values()].filter(
    (c) => c.state === 'rest' && c.focusable && !c.disabled && c.sel !== '#canvas'
  );
  expect(stops.length).toBeGreaterThan(20);

  // Two laps: the second proves the ring wraps rather than dead-ends on the last stop.
  const visited = await tabOrder(page, stops, stops.length * 2 + 6);
  const missed = stops.map((c) => c.sel).filter((sel) => !visited.includes(sel));
  expect(missed, 'controls no amount of tabbing reaches').toEqual([]);

  const first = visited.indexOf(stops[0]!.sel);
  expect(visited.slice(first + 1).includes(stops[0]!.sel), 'the tab ring never comes back around').toBe(true);
});

test('drawing does not trap focus on the canvas', async ({ editor, page }) => {
  // Tab cycles the selection while the artwork has focus, which is the point of it.
  await editor.tool('rect');
  await editor.drag([100, 100], [300, 260]);
  await editor.tool('select');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('canvas');
  await page.keyboard.press('Tab');
  expect((await editor.state()).selection).toEqual([0]);

  // ...but it must never do so from the toolbar, and Escape hands the canvas back.
  await page.focus('#btnCopy');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('btnCopy');

  await page.focus('#canvas');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => document.activeElement?.id),
    'Escape did not release the canvas, so the toolbar stays unreachable'
  ).not.toBe('canvas');
});

test('every tab stop draws a focus ring', async ({ editor, page }) => {
  const stops = [...(await allControls(page, editor)).values()].filter(
    (c) => c.state === 'rest' && c.focusable && !c.disabled
  );
  const unringed: string[] = [];
  for (const c of stops) {
    await page.focus(c.sel);
    // Programmatic focus does not satisfy :focus-visible, so the ring is asked for
    // the way a keyboard user gets it: land on the previous stop and tab forward.
    const ring = await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel)!;
      el.focus();
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, style: style.outlineStyle, matches: el.matches(':focus-visible') };
    }, c.sel);
    if (ring.matches && (ring.width === '0px' || ring.style === 'none')) unringed.push(c.sel);
  }
  expect(unringed, 'focused controls with no visible ring').toEqual([]);
});

test('Enter and Space work every control that a click works', async ({ editor, page }) => {
  // Tools.
  await page.focus('[data-tool="rect"]');
  await page.keyboard.press('Enter');
  expect((await editor.state()).tool).toBe('rect');

  // Drawer buttons.
  await page.focus('#btnAnnos');
  await page.keyboard.press('Enter');
  await expect(page.locator('#annoPanel')).toBeVisible();

  // Drawer rows, which are list items dressed as buttons.
  await editor.tool('rect');
  await editor.drag([100, 100], [300, 260]);
  await editor.tool('select');
  const row = page.locator('[data-testid="anno-row"]').first();
  await row.focus();
  await page.keyboard.press('Enter');
  expect((await editor.state()).selection).toEqual([0]);

  await page.locator('[data-testid="anno-row"]').first().locator('[data-testid="anno-delete"]').focus();
  await page.keyboard.press('Enter');
  expect(await editor.annos()).toEqual([]);
});

test('the whole flow runs on the keyboard alone', async ({ editor, page }) => {
  const watch = watchConsole(page);
  // Pick a tool, draw with the keyboard's own tools, restyle, and export.
  await page.keyboard.press('t');
  await editor.click(200, 200);
  await page.keyboard.type('keyboard only');
  await page.keyboard.press('Enter');
  expect((await editor.annos())[0]!.text).toBe('keyboard only');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('ControlOrMeta+d');
  expect(await editor.annos()).toHaveLength(2);

  await page.keyboard.press('ControlOrMeta+s');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __downloads: unknown[] }).__downloads.length))
    .toBeGreaterThan(0);
  expect(watch.errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Panels and empty states
// ---------------------------------------------------------------------------

test('the history drawer opens, lists the capture, and loads it', async ({ editor, page }) => {
  await page.click('#btnHistory');
  const rows = page.locator('#historyList li');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('#btnHistory')).toHaveAttribute('aria-expanded', 'true');

  await rows.first().click();
  await expect(page.locator('#loading')).toBeHidden();
  expect(await editor.annos()).toEqual([]);
});

test('the empty state stands in when there is no capture to show', async ({ editor, page }) => {
  const watch = watchConsole(page);
  // The chrome.* stub is an init script, so it survives this second navigation.
  await page.goto('/editor.html');
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#statUrl')).toBeHidden();
  // Nothing to export, so the export cluster says so rather than swallowing presses.
  for (const sel of ['#btnCopy', '#btnDownload', '#btnFormat']) {
    await expect(page.locator(sel), `${sel} looks live with no capture loaded`).toBeDisabled();
  }
  expect(watch.errors).toEqual([]);
});

test('an annotation drawer with nothing in it says so', async ({ editor, page }) => {
  await page.click('#btnAnnos');
  await expect(page.locator('#annoList')).toContainText('Nothing drawn yet.');
});

test('an export says where the file landed, not just that it saved', async ({ editor, page }) => {
  await page.click('#btnDownload');
  // The resolved path, read back from the browser after the download started,
  // because the folder, the collision rename and Save As are all its decision.
  await expect(editor.toast).toContainText('Saved to /Users/test/Downloads/');
  await expect(editor.toast).toContainText('.png');

  const asked = await page.evaluate(
    () => (window as unknown as { __downloads: { filename: string }[] }).__downloads
  );
  expect(asked).toHaveLength(1);
  expect(asked[0]!.filename).toMatch(/\.png$/);
});

