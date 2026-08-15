/**
 * Item 5: the redaction tool is recognisable.
 *
 * Its old glyph was a crossed square, which reads as a grid or a table rather than
 * as hiding anything. Of the Lucide candidates, droplets reads as water and
 * scan-face as face detection, but the tool redacts any region at all, so eye-off
 * is the one that says "hide this" without narrowing what "this" may be.
 */
import { expect, test } from './fixtures';

const blur = (page: import('@playwright/test').Page) => page.locator('[data-tool="blur"]');

test('the blur tool wears the lucide eye-off icon', async ({ editor, page }) => {
  // The slash across the eye is the mark of the icon, and the part that carries it.
  const paths = await blur(page).locator('svg path').evaluateAll((els) =>
    els.map((e) => e.getAttribute('d') ?? '')
  );
  expect(paths).toHaveLength(4);
  expect(paths).toContain('m2 2 20 20');
  expect(paths.some((d) => d.startsWith('M14.084 14.158a3 3 0'))).toBe(true);
});

test('its tooltip names both what it does and its key', async ({ editor, page }) => {
  await expect(blur(page)).toHaveAttribute('title', 'Blur / redact (B)');
});

test('the tool itself still redacts', async ({ editor, page }) => {
  await blur(page).click();
  expect((await editor.state()).tool).toBe('blur');
  await editor.drag([100, 100], [300, 220]);
  const annos = await editor.annos();
  expect(annos).toHaveLength(1);
  expect(annos[0]!.kind).toBe('blur');
});

test('B still selects it from the keyboard', async ({ editor, page }) => {
  await page.locator('#canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('b');
  expect((await editor.state()).tool).toBe('blur');
});
