import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const pluginDir = new URL('../plugin/iconverter/', import.meta.url);
const source = await readFile(new URL('iconverter.php', pluginDir), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('declares the plugin version and prevents direct execution', () => {
  assert.match(source, /Plugin Name:\s*iConverter/);
  assert.ok(source.includes(`Version: ${packageJson.version}`));
  assert.ok(source.includes(`define( 'ICONVERTER_VERSION', '${packageJson.version}' );`));
  assert.match(source, /Requires at least:\s*6\.0/);
  assert.match(source, /Requires PHP:\s*7\.4/);
  assert.match(source, /if\s*\(\s*!\s*defined\(\s*'ABSPATH'\s*\)\s*\)\s*\{\s*exit;/s);
});

test('loads only the Breakdance uploader integration', () => {
  const hooks = [...source.matchAll(/add_action\(\s*'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(hooks, ['breakdance_builder_footer']);
  assert.match(source, /assets\/js\/pathkit\.js/);
  assert.match(source, /assets\/js\/svg-converter\.min\.js/);
  assert.match(source, /assets\/wasm\/pathkit\.wasm/);
  assert.doesNotMatch(source, /add_shortcode|wp_enqueue_style|wp_ajax|proc_open|register_rest_route/);
});

test('ships only uploader JavaScript assets', async () => {
  const files = await readdir(new URL('../plugin/iconverter/assets/js/', import.meta.url));
  assert.deepEqual(files.sort(), ['pathkit.js', 'svg-converter.min.js']);
});

test('ships PathKit license notices and attribution', async () => {
  const [license, readme, notices, pathKit] = await Promise.all([
    readFile(new URL('LICENSE-pathkit.txt', pluginDir), 'utf8'),
    readFile(new URL('readme.txt', pluginDir), 'utf8'),
    readFile(new URL('THIRD-PARTY-NOTICES.txt', pluginDir), 'utf8'),
    readFile(new URL('assets/js/pathkit.js', pluginDir), 'utf8'),
  ]);

  assert.match(license, /BSD 3-Clause License/);
  assert.match(license, /Copyright \(c\) 2011 Google Inc\./);
  assert.match(readme, /== Third-Party Software Credits ==/);
  assert.match(readme, /LICENSE-pathkit\.txt/);
  assert.match(notices, /LICENSE-pathkit\.txt/);
  assert.match(pathKit, /Licensed under the BSD 3-Clause License/);
});
