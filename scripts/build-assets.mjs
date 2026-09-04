import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import gettextParser from 'gettext-parser';
import { syncVersion } from './sync-version.mjs';

const require = createRequire(import.meta.url);
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = resolve(projectDir, 'plugin/iconverter');

await syncVersion(projectDir);

await mkdir(resolve(pluginDir, 'assets/js'), { recursive: true });
await mkdir(resolve(pluginDir, 'assets/css'), { recursive: true });
await mkdir(resolve(pluginDir, 'assets/wasm'), { recursive: true });
await mkdir(resolve(pluginDir, 'languages'), { recursive: true });

await build({
  entryPoints: [resolve(projectDir, 'src/browser.js')],
  outfile: resolve(pluginDir, 'assets/js/converter.min.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
});

await build({
  entryPoints: [resolve(projectDir, 'src/converter-worker.js')],
  outfile: resolve(pluginDir, 'assets/js/converter-worker.min.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
});

await build({
  entryPoints: [resolve(projectDir, 'src/breakdance.js')],
  outfile: resolve(pluginDir, 'assets/js/breakdance.min.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
});

await copyFile(
  require.resolve('pathkit-wasm/bin/pathkit.js'),
  resolve(pluginDir, 'assets/js/pathkit.js'),
);
await copyFile(
  require.resolve('pathkit-wasm/bin/pathkit.wasm'),
  resolve(pluginDir, 'assets/wasm/pathkit.wasm'),
);
await copyFile(
  resolve(projectDir, 'src/converter.css'),
  resolve(pluginDir, 'assets/css/converter.css'),
);

const poPath = resolve(pluginDir, 'languages/iconverter-nl_NL.po');
const po = gettextParser.po.parse(await readFile(poPath));
await writeFile(
  resolve(pluginDir, 'languages/iconverter-nl_NL.mo'),
  gettextParser.mo.compile(po),
);

console.log('Built browser assets and translations.');
