"use strict";
(() => {
  // src/lib/capture-common.ts
  function isScrollableTarget(c) {
    return (c.overflowY === "auto" || c.overflowY === "scroll") && c.scrollHeight > c.clientHeight + 100;
  }
  function elementLabel(tagName, w, h) {
    return `${tagName.toLowerCase()} \xB7 ${Math.round(w)} \xD7 ${Math.round(h)}`;
  }

  // src/content/element.ts
  (() => {
    const w = window;
    w.__screencappyElementCleanup?.();
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });
    const root = document.createElement("div");
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
        position: fixed; display: none; box-sizing: border-box;
        border: 1.5px solid #38bdf8; background: rgba(56, 189, 248, .14);
        pointer-events: none;
      }
      .chip {
        position: fixed; display: none; background: #0ea5e9; color: #fff;
        font: 11px/1 system-ui, sans-serif; padding: 5px 8px; border-radius: 6px;
        white-space: nowrap; pointer-events: none;
      }
    </style>
    <div class="hint">Click an element to capture it &nbsp;\xB7&nbsp; scroll to move the page &nbsp;\xB7&nbsp; <b>Esc</b> to cancel</div>
    <div class="box"></div>
    <div class="chip"></div>
  `;
    shadow.appendChild(root);
    document.documentElement.appendChild(host);
    const box = root.querySelector(".box");
    const chip = root.querySelector(".chip");
    let lastClient = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let target = null;
    const retarget = () => {
      const el = document.elementFromPoint(lastClient.x, lastClient.y);
      target = el && el !== document.documentElement ? el : null;
      paint();
    };
    const paint = () => {
      if (!target || !target.isConnected) {
        box.style.display = "none";
        chip.style.display = "none";
        return;
      }
      const r = target.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      chip.style.display = "block";
      chip.textContent = elementLabel(target.tagName, r.width, r.height);
      const cw = chip.offsetWidth;
      const chH = chip.offsetHeight;
      chip.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - cw - 4))}px`;
      const below = r.bottom + 6;
      chip.style.top = below + chH > window.innerHeight ? `${Math.max(4, r.top - chH - 6)}px` : `${below}px`;
    };
    const accessibleFrameDoc = (el) => {
      try {
        return el.contentDocument;
      } catch {
        return null;
      }
    };
    const finish = (msg) => {
      cleanup();
      void chrome.runtime.sendMessage(msg);
    };
    const onMouseMove = (e) => {
      lastClient = { x: e.clientX, y: e.clientY };
      retarget();
    };
    const onScroll = () => retarget();
    const swallow = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onClick = (e) => {
      swallow(e);
      if (e.button !== 0) return;
      lastClient = { x: e.clientX, y: e.clientY };
      const el = document.elementFromPoint(e.clientX, e.clientY) ?? target;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let scrollable = el instanceof HTMLElement && isScrollableTarget({
        overflowY: getComputedStyle(el).overflowY,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight
      });
      let frameUrl;
      if (el instanceof HTMLIFrameElement) {
        const doc = accessibleFrameDoc(el);
        const se = doc?.scrollingElement ?? doc?.documentElement;
        if (se) {
          scrollable = se.scrollHeight > el.clientHeight + 1 || se.scrollWidth > el.clientWidth + 1;
        } else if (el.src && !el.src.startsWith("about:")) {
          frameUrl = el.src;
        }
      }
      if (scrollable) w.__screencappyPickedEl = el;
      finish({
        type: "fs:element",
        scrollable,
        ...frameUrl ? { frameUrl } : {},
        rect: {
          x: Math.round(r.left + window.scrollX),
          y: Math.round(r.top + window.scrollY),
          w: Math.max(1, Math.round(r.width)),
          h: Math.max(1, Math.round(r.height))
        }
      });
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish({ type: "fs:element-cancel" });
      }
    };
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("mousedown", swallow, true);
    window.addEventListener("mouseup", swallow, true);
    window.addEventListener("pointerdown", swallow, true);
    window.addEventListener("pointerup", swallow, true);
    function cleanup() {
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("mousedown", swallow, true);
      window.removeEventListener("mouseup", swallow, true);
      window.removeEventListener("pointerdown", swallow, true);
      window.removeEventListener("pointerup", swallow, true);
      host.remove();
      delete w.__screencappyElementCleanup;
    }
    w.__screencappyElementCleanup = cleanup;
  })();
})();
