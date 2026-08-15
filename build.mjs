import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { toFirefoxManifest } from './scripts/firefox-manifest.mjs';

const watch = process.argv.includes('--watch');
const zip = process.argv.includes('--zip');
const targetArg = process.argv.find((a) => a.startsWith('--target='));
const buildTarget = targetArg ? targetArg.slice('--target='.length) : 'chrome';
if (buildTarget !== 'chrome' && buildTarget !== 'firefox' && buildTarget !== 'store-fallback') {
  console.error(`Unknown --target=${buildTarget}, expected chrome, firefox, or store-fallback`);
  process.exit(1);
}
const outdir =
  buildTarget === 'firefox' ? 'dist-firefox' : buildTarget === 'store-fallback' ? 'dist-store-fallback' : 'dist';
const zipName =
  buildTarget === 'firefox'
    ? 'screencappy-firefox.zip'
    : buildTarget === 'store-fallback'
      ? 'screencappy-store-fallback.zip'
      : 'screencappy.zip';

const entries = {
  background: 'src/background.ts',
  'content-capture': 'src/content/capture.ts',
  'content-select': 'src/content/select.ts',
  'content-element': 'src/content/element.ts',
  editor: 'src/editor/editor.ts',
  options: 'src/options/options.ts',
};

if (!zip) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
}

const ctx = await esbuild.context({
  entryPoints: Object.entries(entries).map(([out, src]) => ({ out, in: src })),
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  sourcemap: watch ? 'inline' : false,
  minify: false,
  logLevel: 'info',
});

async function copyStatic() {
  // The manifest version is stamped from package.json so release-please owns versioning.
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  let manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
  manifest.version = pkg.version;
  if (buildTarget === 'firefox') manifest = toFirefoxManifest(manifest);
  // The store-fallback build drops the debugger permission entirely; the code
  // feature-detects chrome.debugger and hides the captures that need it.
  if (buildTarget === 'store-fallback') {
    manifest.permissions = manifest.permissions.filter((p) => p !== 'debugger');
  }
  await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2));
  await cp('src/editor/editor.html', `${outdir}/editor.html`);
  await cp('src/editor/editor.css', `${outdir}/editor.css`);
  await cp('src/options/options.html', `${outdir}/options.html`);
  await cp('src/options/options.css', `${outdir}/options.css`);
  await cp('src/icons', `${outdir}/icons`, { recursive: true });
  // Both pages sit at the bundle root, so one shared folder serves them both.
  // The fonts ship with the extension because an extension page has no network.
  await cp('src/fonts', `${outdir}/fonts`, { recursive: true });
}

if (watch) {
  await copyStatic();
  await ctx.watch();
  console.log(`watching… load the ${outdir}/ folder as an unpacked extension`);
} else {
  await ctx.rebuild();
  await copyStatic();
  await ctx.dispose();
  if (zip) {
    execFileSync('zip', ['-r', '-X', `../${zipName}`, '.'], { cwd: outdir, stdio: 'inherit' });
  }
}
