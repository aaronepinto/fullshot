# Screencappy 📸

**One-click full page screenshots for Chrome - capture, annotate, export. Free, open source, private by design.**

Screencappy is a modern, MIT-licensed alternative to GoFullPage, built for the developer community. Everything that's paid elsewhere - annotation, blur/redaction, emoji, PDF export - is free here, and nothing ever leaves your machine: no account, no cloud, no analytics, no host permissions.

## Features

- **One click → full page.** Click the toolbar icon (or `Alt+Shift+P`) and the whole page is captured, including everything below the fold and off to the right.
- **Three capture modes.** Full page, visible area (`Alt+Shift+V`), or drag-select a region (`Alt+Shift+S`) - you can even scroll mid-selection to grab a region taller than the viewport.
- **Two capture engines.**
  - **Scroll & stitch** (default): uses only the `activeTab` gesture - the extension requests *zero* host permissions. Handles sticky headers, fixed overlays, lazy-loaded images, scrollbar removal, CSS animations, high-DPI screens, and browser zoom.
  - **Turbo** (opt-in): a one-shot, pixel-perfect capture via the DevTools Protocol (`Page.captureScreenshot` with `captureBeyondViewport`). No scrolling, no stitching seams, immune to sticky headers. Requires the optional `debugger` permission, granted only if you enable it in Settings.
- **A real editor, free.** Crop, arrows, lines, rectangles, ellipses, freehand pen, highlighter, text, emoji stamps, and blur/pixelate redaction - all vector-based and non-destructive with full undo/redo, zoom, and pan.
- **Export anywhere.** PNG, JPEG, WebP, PDF (single tall page or A4/Letter pagination - the PDF writer is hand-rolled, zero dependencies), or straight to the clipboard. Filename templates like `{domain} {date} {time}`.
- **Huge pages just work.** The composed image is stored as strips, so pages taller than the browser's canvas limits render fine and exports auto-split into numbered files / extra PDF pages instead of failing.
- **Local capture history.** Recent captures (with annotations) live in IndexedDB with thumbnails; prune limits are configurable. Nothing syncs anywhere.
- **Restricted pages degrade gracefully.** `chrome://` pages and the Web Store can't be scripted, so Screencappy falls back to a visible-area capture instead of erroring.

## Install (from source)

```sh
bun install        # or: npm install
bun run build      # outputs the unpacked extension to dist/
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and pick the `dist/` folder. `bun run watch` rebuilds on save while you develop.

## Architecture

Zero runtime dependencies. TypeScript, bundled by esbuild, Manifest V3.

```
src/
  manifest.json          MV3 manifest (version stamped from package.json at build time)
  background.ts          Service worker: gestures → capture orchestration → editor tab
  cdp.ts                 Turbo engine (chrome.debugger + CDP, optional permission)
  content/capture.ts     Injected on demand: measures, neutralizes sticky/fixed/animations,
                         drives the scroll loop, restores the page afterwards
  content/select.ts      Region-selection overlay (shadow DOM, scroll-through)
  editor/                The capture tab: stitching, annotation tools, export, history
    stitch.ts            Tiles → strip-backed BigImage (no canvas-size ceilings)
    annotations.ts       Vector annotation model: draw, hit-test, handles
    export.ts            PNG/JPEG/WebP/PDF/clipboard with automatic splitting
  lib/                   IndexedDB, settings (chrome.storage.sync), filename templates,
                         and a minimal dependency-free PDF writer
```

**How a stitch capture flows:** user gesture → `activeTab` grants access → content script measures and preps the page (pins `position: sticky` elements back into flow, hides `position: fixed` elements after the first frame, hides scrollbars, optionally pre-scrolls to trigger lazy loading) → the worker scrolls tile-by-tile calling `captureVisibleTab` (throttled under Chrome's 2-calls/sec quota) → tiles land in IndexedDB → the editor tab composes them into strips, derives the true device-pixel scale from the bitmaps themselves, and everything after that (annotate/export) is pure local canvas work.

## CI/CD & releases

- **CI** (`.github/workflows/ci.yml`): typecheck + build + packed-zip artifact on every push/PR, running on Bun.
- **Releases** (`release.yml`): [release-please](https://github.com/googleapis/release-please) turns Conventional Commits on `main` into release PRs; merging one tags a semver release and attaches the extension zip. Set the `PUBLISH_TO_CWS` repo variable plus `CWS_*` secrets to also auto-publish to the Chrome Web Store.
- **Conventional Commits** are enforced on PR titles in CI, and locally via `git config core.hooksPath .githooks`.

## Privacy

Screencappy requests `activeTab`, `scripting`, `storage`, `downloads`, `contextMenus`, and `unlimitedStorage` - no host permissions, so it cannot read any page until you invoke it. The optional Turbo engine additionally uses `debugger`, and only if you grant it. There is no network code in this extension at all.

## License

[MIT](LICENSE)
