# Contributing to Screencappy

Thanks for taking the time. Screencappy is a small, dependency-free codebase, so the loop is short and there is not much to learn before you can be useful.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## The most useful contribution

A **real, public URL where a capture comes out wrong**. Screenshot stitching breaks in site-specific ways: an unusual sticky header, a virtualized list, a canvas that repaints on scroll, a lazy-loader that needs two passes. Those bugs are almost impossible to guess at and trivial to fix once someone hands over a page that reproduces them.

Use the [capture problem form](https://github.com/aaronepinto/smollet-screencappy/issues/new/choose) and include the URL, even if the page looks boring.

## Setup

You need [Bun](https://bun.com) and a Chromium browser. Node also works if you prefer it, but the lockfile and CI are Bun.

```sh
git clone https://github.com/aaronepinto/smollet-screencappy.git
cd screencappy
bun install
bun run build
```

Load the extension: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `dist/`.

Enable the commit message hook once per clone:

```sh
git config core.hooksPath .githooks
```

## Development loop

```sh
bun run watch       # rebuild dist/ on save
bun run typecheck   # tsc --noEmit
bun run test        # unit tests
bun run e2e         # end-to-end capture against a real Chromium browser
bun run e2e:firefox # the same capture against a real Firefox
```

`bun run watch` rebuilds, but Chrome does not reload the extension for you. After a rebuild, hit the reload icon on the Screencappy card in `chrome://extensions`. Changes to the service worker (`background.ts`) always need that reload. Changes inside the editor tab only need a page refresh.

Before opening a pull request, run the three checks that CI runs:

```sh
bun run typecheck && bun run test && bun run build
```

## Testing

**Unit tests** live in `tests/unit` and run under `bun test`. They cover the pure logic: the tile grid maths, filename templating, and the PDF writer. Anything that can be tested without a browser belongs here.

```sh
bun run test                    # all unit tests
bun test tests/unit/pdf.test.ts # one file
bun test --coverage             # with a coverage summary
```

**End-to-end** (`tests/e2e.mjs`) drives a real Chromium browser through puppeteer-core, loads the built extension, and asserts on an actual capture. It needs a built `dist/`, so run `bun run build` first. It defaults to whatever Chrome it can find; set `CHROME=/path/to/binary` to point it at Edge or Brave, and `BROWSER=edge` to label the output. CI runs it against Chrome, Edge and Brave on every push and pull request.

**End-to-end, Firefox** (`tests/e2e-firefox.mjs`) runs the same scenarios against a real Firefox through selenium-webdriver and geckodriver. It needs `bun run build:firefox` first, and takes `FIREFOX=/path/to/binary`. Reaching an extension page under WebDriver takes some setup that the file explains at the top; read that before changing it. CI runs it alongside `bun run lint:firefox`, Mozilla's own add-on validator.

Both e2e suites share their fixture pages and their expected dimensions through `tests/fixtures.mjs`, so a new scenario shows up in every browser at once.

### Adding a capture regression test

If you fix a site-specific stitching bug, reproduce the offending structure in `tests/fixture.html` (a sticky header at a particular height, an element that only paints on scroll, and so on) rather than pointing the test at a live site. Live sites change and the test rots. A minimal fixture that fails before your fix and passes after is the goal.

## Architecture in one paragraph

The service worker (`src/background.ts`) owns capture orchestration. A user gesture grants `activeTab`, `src/content/capture.ts` is injected to measure and prepare the page, the worker scrolls and calls `captureVisibleTab` tile by tile under Chrome's two-calls-per-second quota, tiles are written to IndexedDB, and the editor tab (`src/editor/`) composes them into strips and does all annotation and export work locally on canvas. The Turbo engine (`src/cdp.ts`) short-circuits all of that with a single DevTools Protocol capture when the user has granted the optional `debugger` permission. `src/lib/` holds the shared pieces: storage, settings, filename templates, and a hand-rolled PDF writer.

Two constraints that are easy to violate by accident:

- **Zero runtime dependencies.** Nothing in `src/` may import a package. `package.json` has devDependencies only, and that is deliberate: it is the property that lets the privacy claims be checked by reading the source. If you think you need a library, open an issue first.
- **No network code.** The extension makes no requests, ever. No telemetry, no remote config, no font or asset fetches. A pull request that adds a `fetch` will not be merged.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). This is not decoration: [release-please](https://github.com/googleapis/release-please) reads the commit history to decide the next version and to write the changelog.

```
feat: add WebP export
fix(stitch): handle sticky headers taller than one tile
docs: document the Turbo permission prompt
```

Types in use, and where each lands in the changelog:

| Type | Changelog section | Version bump |
| :-- | :-- | :-- |
| `feat` | ✨ Features | minor |
| `fix` | 🐛 Bug fixes | patch |
| `perf` | ⚡ Performance | patch |
| `refactor` | ♻️ Refactoring | patch |
| `docs` | 📝 Documentation | none |
| `test` | ✅ Tests | none |
| `build` | 📦 Build | none |
| `ci` | hidden | none |
| `chore` | hidden | none |

A breaking change gets a `!` after the type (`feat!: ...`) or a `BREAKING CHANGE:` footer.

The `commit-msg` hook validates this locally once you have set `core.hooksPath`. CI validates the **pull request title** as well, because pull requests are squash-merged and the title becomes the commit on `main`.

## Pull requests

- Branch off `main`. One logical change per pull request.
- Give the pull request a Conventional Commit title. CI will fail on it otherwise.
- Fill in the Summary and Test Plan sections in the template. For anything that changes what a capture or the editor looks like, attach a before and after screenshot.
- Keep the diff focused. Drive-by reformatting of unrelated files makes review slow.
- Pull requests are squash-merged, so you do not need to rebase or tidy intermediate commits.

## Releases

You do not need to do anything to cut a release. release-please keeps an open release pull request on `main` that accumulates the changelog and the version bump. Merging it tags the version, publishes a GitHub release, and attaches the packed extension zip. Version numbers in `src/manifest.json` are stamped from `package.json` at build time, so never edit the manifest version by hand.

## Questions

Open an [issue](https://github.com/aaronepinto/smollet-screencappy/issues/new/choose) for bugs, questions, and ideas. For anything security related, see [SECURITY.md](SECURITY.md).
