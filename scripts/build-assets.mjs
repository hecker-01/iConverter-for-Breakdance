import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { syncVersion } from './sync-version.mjs';

const require = createRequire(import.meta.url);
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = resolve(projectDir, 'plugin/iconverter');

await syncVersion(projectDir);

await mkdir(resolve(pluginDir, 'assets/js'), { recursive: true });
await mkdir(resolve(pluginDir, 'assets/wasm'), { recursive: true });

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

console.log('Built Breakdance uploader assets.');
