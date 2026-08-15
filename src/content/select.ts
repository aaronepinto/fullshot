/**
 * Region selection overlay. Injected on demand; the user drags a rectangle
 * (scrolling is allowed mid-selection), then the rect is reported to the
 * background in page CSS coordinates. Esc cancels.
 */
import type { RuntimeMsg } from '../lib/types';

(() => {
  const w = window as typeof window & { __screencappySelectCleanup?: () => void };
  w.__screencappySelectCleanup?.();

  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const root = document.createElement('div');
  root.innerHTML = `
    <style>
      .hint {
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        background: rgba(15, 23, 42, .92); color: #e2e8f0;
        font: 13px/1.4 system-ui, sans-serif; padding: 8px 14px; border-radius: 999px;
        box-shadow: 0 4px 16px rgba(0,0,0,.35); pointer-events: none; white-space: nowrap;
      }
      .hint b { color: #7dd3fc; font-weight: 600; }
      .box {
        position: fixed; display: none; border: 1.5px dashed #38bdf8;
        background: rgba(56, 189, 248, .08);
        box-shadow: 0 0 0 100000px rgba(15, 23, 42, .35);
      }
      .size {
        position: absolute; right: 0; bottom: -26px; background: #0ea5e9; color: #fff;
        font: 11px/1 system-ui, sans-serif; padding: 5px 8px; border-radius: 6px;
        white-space: nowrap;
      }
    </style>
    <div class="hint">Drag to select a region &nbsp;·&nbsp; scroll to move the page &nbsp;·&nbsp; <b>Esc</b> to cancel</div>
    <div class="box"><div class="size"></div></div>
  `;
  shadow.appendChild(root);
  document.documentElement.appendChild(host);

  const box = root.querySelector<HTMLDivElement>('.box')!;
  const sizeLabel = root.querySelector<HTMLDivElement>('.size')!;

  // Anchor is stored in page coordinates so the selection stays glued to content
  // even when the user scrolls mid-drag.
  let startPage: { x: number; y: number } | null = null;
  let lastClient = { x: 0, y: 0 };

  const pageRect = () => {
    if (!startPage) return null;
    const curX = lastClient.x + window.scrollX;
    const curY = lastClient.y + window.scrollY;
    const x = Math.min(startPage.x, curX);
    const y = Math.min(startPage.y, curY);
    return { x, y, w: Math.abs(curX - startPage.x), h: Math.abs(curY - startPage.y) };
  };

  const paint = () => {
    const r = pageRect();
    if (!r) return;
    box.style.display = 'block';
    box.style.left = `${r.x - window.scrollX}px`;
    box.style.top = `${r.y - window.scrollY}px`;
    box.style.width = `${r.w}px`;
    box.style.height = `${r.h}px`;
    sizeLabel.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
  };

  const finish = (msg: RuntimeMsg) => {
    cleanup();
    void chrome.runtime.sendMessage(msg);
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startPage = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
    lastClient = { x: e.clientX, y: e.clientY };
    paint();
  };
  const onMouseMove = (e: MouseEvent) => {
    lastClient = { x: e.clientX, y: e.clientY };
    if (startPage) paint();
  };
  const onMouseUp = () => {
    const r = pageRect();
    startPage = null;
    if (r && r.w >= 8 && r.h >= 8) {
      finish({
        type: 'fs:selection',
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
      });
    } else {
      box.style.display = 'none';
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish({ type: 'fs:selection-cancel' });
    }
  };
  const onScroll = () => {
    if (startPage) paint();
  };

  host.addEventListener('mousedown', onMouseDown);
  host.addEventListener('mousemove', onMouseMove);
  host.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, { passive: true });

  function cleanup() {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll);
    host.remove();
    delete w.__screencappySelectCleanup;
  }
  w.__screencappySelectCleanup = cleanup;
})();
