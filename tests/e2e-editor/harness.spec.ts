/** Item 0: the test surface itself, so every other spec can trust its readings. */
import { expect, test } from './fixtures';

test('a freshly seeded capture opens with no annotations', async ({ editor }) => {
  const state = await editor.state();
  expect(state.annos).toEqual([]);
  expect(state.selection).toEqual([]);
  expect(state.undoDepth).toBe(0);
  expect(state.redoDepth).toBe(0);
});

test('reported annotations match what was persisted to IndexedDB', async ({ editor, page }) => {
  await editor.tool('rect');
  await editor.drag([120, 140], [420, 360]);

  const reported = (await editor.state()).annos;
  expect(reported).toHaveLength(1);

  const readStored = () =>
    page.evaluate(async () => {
      const id = new URLSearchParams(location.search).get('id');
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('screencappy', 1);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const rec: { annos?: unknown[] } = await new Promise((res, rej) => {
        const r = db.transaction(['captures']).objectStore('captures').get(id!);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      db.close();
      return rec.annos ?? [];
    });

  // persistAnnos debounces by 400ms, so poll rather than assert straight away.
  await expect.poll(readStored, { timeout: 5000 }).toEqual(reported);
});

for (const percent of [25, 100, 400]) {
  test(`image and client coordinates round-trip at ${percent}% zoom`, async ({ editor, page }) => {
    await editor.setZoom(percent);
    for (const [x, y] of [
      [0, 0],
      [450, 350],
      [899, 699],
    ] as [number, number][]) {
      const back = await page.evaluate(
        (p) => {
          const api = (
            window as unknown as {
              __screencappyTest: {
                imageToClient(x: number, y: number): { x: number; y: number };
                clientToImage(x: number, y: number): { x: number; y: number };
              };
            }
          ).__screencappyTest;
          const c = api.imageToClient(p.x, p.y);
          return api.clientToImage(c.x, c.y);
        },
        { x, y }
      );
      expect(Math.abs(back.x - x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(back.y - y)).toBeLessThanOrEqual(0.5);
    }
  });
}
