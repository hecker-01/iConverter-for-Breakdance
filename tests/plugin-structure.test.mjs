import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../plugin/iconverter/iconverter.php', import.meta.url), 'utf8');
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
  assert.match(source, /assets\/js\/breakdance\.min\.js/);
  assert.match(source, /assets\/wasm\/pathkit\.wasm/);
  assert.doesNotMatch(source, /add_shortcode|wp_enqueue_style|wp_ajax|proc_open|register_rest_route/);
});

test('ships only uploader JavaScript assets', async () => {
  const files = await readdir(new URL('../plugin/iconverter/assets/js/', import.meta.url));
  assert.deepEqual(files.sort(), ['breakdance.min.js', 'pathkit.js']);
});
