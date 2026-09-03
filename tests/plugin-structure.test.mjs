import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../plugin/iconverter/iconverter.php', import.meta.url), 'utf8');
const translation = await readFile(new URL('../plugin/iconverter/languages/iconverter-nl_NL.po', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const escapedVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('declares the expected WordPress plugin metadata', () => {
  assert.match(source, /Plugin Name:\s*iConverter/);
  assert.match(source, new RegExp(`Version:\\s*${escapedVersion}`));
  assert.match(source, new RegExp(`ICONVERTER_VERSION', '${escapedVersion}'`));
  assert.match(translation, new RegExp(`Project-Id-Version: iConverter ${escapedVersion}`));
  assert.match(source, /Requires at least:\s*6\.0/);
  assert.match(source, /Requires PHP:\s*7\.4/);
  assert.match(source, /Text Domain:\s*iconverter/);
  assert.match(source, /Domain Path:\s*\/languages/);
});

test('prevents direct execution and registers only converter', () => {
  assert.match(source, /if\s*\(\s*!\s*defined\(\s*'ABSPATH'\s*\)\s*\)\s*\{\s*exit;/s);
  const registrations = [...source.matchAll(/add_shortcode\(\s*'([^']+)'/g)];
  assert.deepEqual(registrations.map((match) => match[1]), ['converter']);
});

test('loads local assets only from the shortcode', () => {
  assert.match(source, /assets\/js\/pathkit\.js/);
  assert.match(source, /assets\/js\/converter\.min\.js/);
  assert.match(source, /assets\/wasm\/pathkit\.wasm/);
  assert.match(source, /data-iconverter-config/);
  assert.match(source, /function iconverter_render_converter[\s\S]*wp_enqueue_style\( 'iconverter' \)/);
  assert.match(source, /function iconverter_render_converter[\s\S]*wp_enqueue_script\( 'iconverter' \)/);
  assert.doesNotMatch(source, /wp_ajax|register_rest_route|media_handle_upload/);
});

test('ships Dutch translations for the public interface', () => {
  assert.match(translation, /"Language: nl_NL/);
  assert.match(translation, /msgid "SVG converter"\nmsgstr "SVG omzetten"/);
  assert.match(translation, /msgid "Complete"\nmsgstr "Voltooid"/);
  assert.match(translation, /msgid "Download all"\nmsgstr "Alles downloaden"/);
  assert.match(translation, /msgid "More info"\nmsgstr "Meer informatie"/);
});
