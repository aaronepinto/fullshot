# Screencappy 📸

**One-click full page screenshots for Chrome - capture, annotate, export. Free, open source, private by design.**

Screencappy is a modern, MIT-licensed alternative to GoFullPage, built for the developer community. Everything that's paid elsewhere - annotation, blur/redaction, emoji, PDF export - is free here, and nothing ever leaves your machine: no account, no cloud, no analytics, no host permissions.

## Features

- **One click → full page.** Click the toolbar icon (or `Alt+Shift+P`) and the whole page is captured, including everything below the fold and off to the right.
- **Four capture modes.** Full page, visible area (`Alt+Shift+V`), drag-select a region (`Alt+Shift+S`) - you can even scroll mid-selection to grab a region taller than the viewport - or pick an element DevTools-style: hover highlights the node under the cursor, click captures exactly it, and scrollable containers are captured with their entire scrollable content.
- **Delayed capture.** Need a menu open or a hover state visible? Set a start delay (3, 5, or 10 seconds) in Settings, or right-click and pick "Capture full page in 5s"; the toolbar badge counts down before the shot.
- **Two capture engines.**
  - **Scroll & stitch** (default): uses only the `activeTab` gesture - the extension requests *zero* host permissions. Handles sticky headers, fixed overlays, lazy-loaded images, scrollbar removal, CSS animations, high-DPI screens, and browser zoom.
  - **Turbo** (opt-in): a one-shot, pixel-perfect capture via the DevTools Protocol (`Page.captureScreenshot` with `captureBeyondViewport`). No scrolling, no stitching seams, immune to sticky headers. Requires the optional `debugger` permission, granted only if you enable it in Settings.
  - **Capture as mobile** (uses Turbo): right-click and pick "Capture as mobile (390px)" to reflow the page to a phone-width layout via DevTools device emulation - your real window never resizes - and capture the full mobile page at 2x. The emulated width is configurable in Settings.
- **A real editor, free.** Crop, arrows, lines, rectangles, ellipses, freehand pen, highlighter, text, emoji stamps, and blur/pixelate redaction - all vector-based and non-destructive with full undo/redo, zoom, and pan.
- **Export anywhere.** PNG, JPEG, WebP, PDF (single tall page or A4/Letter pagination - the PDF writer is hand-rolled, zero dependencies), or straight to the clipboard. Filename templates like `{domain} {date} {time}`.
- **Searchable PDF.** Right-click and "Save as searchable PDF" prints the live page via the DevTools Protocol (`Page.printToPDF`) into a real PDF with selectable, searchable text - unlike image-based PDFs - and downloads it directly. Uses the same optional `debugger` permission as Turbo, requested on first use.
- **Infinite scroll, handled.** Enable "Auto-load more content" in Settings and Screencappy keeps scrolling to the bottom until the page stops growing (bounded by the max capture height and a time budget), then captures the fully loaded page.
- **SPA scroll containers.** When the window itself barely scrolls (Gmail, Slack, Notion style apps), Screencappy detects the inner container that holds the real content and captures all of it instead of a single viewport.
- **Iframes, in depth.** Pick an iframe with the element picker and you get its *entire* content, not just the part visible in its box: same-origin frames are scrolled and stitched internally, cross-origin frames are deep-captured via the DevTools Protocol when the Turbo permission is granted, and anything else falls back to the frame's visible box.
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
  content/element.ts     Element picker overlay (DevTools-style hover highlight)
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

Screencappy requests `activeTab`, `scripting`, `storage`, `downloads`, `contextMenus`, and `unlimitedStorage` - no host permissions, so it cannot read any page until you invoke it. The optional Turbo engine and the searchable PDF export additionally use `debugger`, and only if you grant it. There is no network code in this extension at all.

## License

[Apache-2.0](LICENSE)
