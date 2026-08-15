import { describe, expect, test } from 'bun:test';
import { MAX_SCAN_NODES, walkShadowTree } from '../../src/lib/capture-common';

interface FakeEl {
  name: string;
  children: FakeEl[];
  shadowRoot?: { children: FakeEl[] } | null;
}

function el(name: string, children: FakeEl[] = [], shadow?: FakeEl[]): FakeEl {
  return { name, children, shadowRoot: shadow ? { children: shadow } : null };
}

function names(roots: FakeEl[], budget = MAX_SCAN_NODES): string[] {
  const out: string[] = [];
  walkShadowTree<FakeEl>(roots, (n) => out.push(n.name), budget);
  return out;
}

describe('walkShadowTree', () => {
  test('visits nothing for empty roots', () => {
    expect(names([])).toEqual([]);
  });

  test('preorder over light DOM in document order', () => {
    const tree = el('a', [el('b', [el('c')]), el('d')]);
    expect(names([tree])).toEqual(['a', 'b', 'c', 'd']);
  });

  test('descends into open shadow roots, shadow children before light children', () => {
    // host has shadow content (header inside) plus a slotted light child.
    const host = el('host', [el('slotted', [el('slotted-child')])], [el('sh-header', [el('sh-deep')])]);
    expect(names([host, el('after')])).toEqual([
      'host',
      'sh-header',
      'sh-deep',
      'slotted',
      'slotted-child',
      'after',
    ]);
  });

  test('elements reachable through a slot are visited exactly once', () => {
    // Slot assignment is not followed: the slotted element lives only in the host's
    // light children, exactly like the real DOM, so counts stay at one.
    const slotted = el('slotted');
    const host = el('host', [slotted], [el('slot')]);
    const counts = new Map<FakeEl, number>();
    walkShadowTree<FakeEl>([host], (n) => counts.set(n, (counts.get(n) ?? 0) + 1), 100);
    expect(counts.get(slotted)).toBe(1);
    expect([...counts.values()].every((c) => c === 1)).toBe(true);
  });

  test('skips closed shadow roots (shadowRoot is null)', () => {
    const host = el('host', [el('light')]);
    host.shadowRoot = null;
    expect(names([host])).toEqual(['host', 'light']);
  });

  test('stops at the visit budget and returns the count', () => {
    const roots = [el('a', [el('b'), el('c')]), el('d')];
    const out: string[] = [];
    const visited = walkShadowTree<FakeEl>(roots, (n) => out.push(n.name), 3);
    expect(visited).toBe(3);
    expect(out).toEqual(['a', 'b', 'c']);
  });

  test('a zero budget visits nothing', () => {
    expect(walkShadowTree<FakeEl>([el('a')], () => {}, 0)).toBe(0);
  });

  test('handles a deep chain without recursion limits', () => {
    let root = el('leaf');
    for (let i = 0; i < 50_000; i++) root = el(`n${i}`, [root]);
    const visited = walkShadowTree<FakeEl>([root], () => {}, MAX_SCAN_NODES);
    expect(visited).toBe(50_001);
  });
});
