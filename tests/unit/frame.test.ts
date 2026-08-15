import { describe, expect, test } from 'bun:test';
import { pickFrameTarget, type FrameTargetInfo } from '../../src/lib/capture-common';

function target(over: Partial<FrameTargetInfo> = {}): FrameTargetInfo {
  return {
    targetId: 't1',
    type: 'iframe',
    url: 'https://embed.example.com/widget',
    ...over,
  };
}

describe('pickFrameTarget', () => {
  test('returns null with no targets', () => {
    expect(pickFrameTarget([], 'https://embed.example.com/widget')).toBeNull();
  });

  test('exact URL match wins', () => {
    const a = target({ targetId: 'a', url: 'https://embed.example.com/a' });
    const b = target({ targetId: 'b', url: 'https://embed.example.com/b' });
    expect(pickFrameTarget([a, b], 'https://embed.example.com/b')).toBe(b);
  });

  test('ignores non-iframe targets even on exact URL match', () => {
    const page = target({ type: 'page' });
    const worker = target({ type: 'service_worker' });
    expect(pickFrameTarget([page, worker], page.url)).toBeNull();
  });

  test('matches ignoring the fragment when the frame self-navigated to an anchor', () => {
    const other = target({ targetId: 'o', url: 'https://x.com/other' });
    const a = target({ targetId: 'a', url: 'https://embed.example.com/widget#section-2' });
    expect(pickFrameTarget([other, a], 'https://embed.example.com/widget')).toBe(a);
    const plain = target();
    expect(pickFrameTarget([other, plain], 'https://embed.example.com/widget#top')).toBe(plain);
  });

  test('exact match beats a fragment-stripped match', () => {
    const anchored = target({ targetId: 'a', url: 'https://e.com/w#x' });
    const exact = target({ targetId: 'b', url: 'https://e.com/w' });
    expect(pickFrameTarget([anchored, exact], 'https://e.com/w')).toBe(exact);
  });

  test('falls back to the sole iframe target when URLs diverge (redirects)', () => {
    const redirected = target({ url: 'https://embed.example.com/widget/v2' });
    expect(pickFrameTarget([redirected], 'https://embed.example.com/widget')).toBe(redirected);
  });

  test('returns null when several iframe targets exist and none match', () => {
    const a = target({ targetId: 'a', url: 'https://x.com/1' });
    const b = target({ targetId: 'b', url: 'https://x.com/2' });
    expect(pickFrameTarget([a, b], 'https://embed.example.com/widget')).toBeNull();
  });

  test('non-iframe targets do not count toward the sole-target fallback', () => {
    const page = target({ targetId: 'p', type: 'page', url: 'https://top.example.com/' });
    const frame = target({ targetId: 'f', url: 'https://embed.example.com/moved' });
    expect(pickFrameTarget([page, frame], 'https://embed.example.com/widget')).toBe(frame);
  });
});
