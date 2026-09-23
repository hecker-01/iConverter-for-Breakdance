import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  outfile: resolve(pluginDir, 'assets/js/svg-converter.min.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
});

const pathKitAttribution = `/*
 * PathKit — part of the Skia project
 * Copyright (c) 2011 Google Inc. All rights reserved.
 * Licensed under the BSD 3-Clause License.
 * See LICENSE-pathkit.txt in this plugin's root directory.
 */

`;
const pathKitSource = await readFile(require.resolve('pathkit-wasm/bin/pathkit.js'), 'utf8');

await writeFile(
  resolve(pluginDir, 'assets/js/pathkit.js'),
  pathKitAttribution + pathKitSource,
);
await copyFile(
  require.resolve('pathkit-wasm/bin/pathkit.wasm'),
  resolve(pluginDir, 'assets/wasm/pathkit.wasm'),
);

console.log('Built Breakdance uploader assets.');
