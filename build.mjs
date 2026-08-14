import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const watch = process.argv.includes('--watch');
const zip = process.argv.includes('--zip');
const outdir = 'dist';

const entries = {
  background: 'src/background.ts',
  'content-capture': 'src/content/capture.ts',
  'content-select': 'src/content/select.ts',
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
  const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
  manifest.version = pkg.version;
  await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2));
  await cp('src/editor/editor.html', `${outdir}/editor.html`);
  await cp('src/editor/editor.css', `${outdir}/editor.css`);
  await cp('src/options/options.html', `${outdir}/options.html`);
  await cp('src/options/options.css', `${outdir}/options.css`);
  await cp('src/icons', `${outdir}/icons`, { recursive: true });
}

if (watch) {
  await copyStatic();
  await ctx.watch();
  console.log('watching… load the dist/ folder as an unpacked extension');
} else {
  await ctx.rebuild();
  await copyStatic();
  await ctx.dispose();
  if (zip) {
    execFileSync('zip', ['-r', '-X', '../fullshot.zip', '.'], { cwd: outdir, stdio: 'inherit' });
  }
}
