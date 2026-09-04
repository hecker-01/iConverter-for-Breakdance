import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import PathKitInit from 'pathkit-wasm';
import { convertIconSvg, hookFetch, prepareUpload } from '../src/breakdance.js';

const require = createRequire(import.meta.url);
const wasm = await readFile(require.resolve('pathkit-wasm/bin/pathkit.wasm'));
const nativeFetch = globalThis.fetch;
globalThis.DOMParser = DOMParser;
globalThis.PathKitInit = PathKitInit;
globalThis.window = { iconverterBreakdanceConfig: { wasmUrl: 'https://example.test/pathkit.wasm' } };
let engineLoads = 0;
globalThis.fetch = async () => { engineLoads++; return { ok: true, arrayBuffer: async () => wasm }; };
const raw = '<svg viewBox="0 0 24 24"><rect width="20" height="20"/></svg>';
const unsupported = '<svg viewBox="0 0 24 24"><text>Hello</text></svg>';
const payload = () => new URLSearchParams({ action: 'breakdance_upload_icons', 'icons[0][svgCode]': raw, 'icons[1][svgCode]': raw, _nonce: 'keep-me', 'iconSet[name]': 'Test' });

test('repeated and concurrent inputs reuse the converted output', async () => {
  const outputs = await Promise.all([convertIconSvg(raw), convertIconSvg(raw)]);
  assert.match(outputs[0], /<path /);
  assert.equal(outputs[0], outputs[1]);
  assert.equal(await convertIconSvg(raw), outputs[0]);
  assert.equal(await convertIconSvg(outputs[0]), outputs[0]);
  assert.equal(engineLoads, 1);
});

test('all supported payload formats convert duplicate icons and preserve metadata', async () => {
  for (const body of [payload(), payload().toString(), new FormData()]) {
    if (body instanceof FormData) for (const entry of payload()) body.append(...entry);
    const output = await prepareUpload(body)();
    const values = typeof output === 'string' ? new URLSearchParams(output) : output;
    assert.match(values.get('icons[0][svgCode]'), /<path /);
    assert.equal(values.get('icons[0][svgCode]'), values.get('icons[1][svgCode]'));
    assert.equal(values.get('_nonce'), 'keep-me');
    assert.equal(values.get('iconSet[name]'), 'Test');
  }
  const icons = [{ svgCode: raw, name: 'rectangle' }];
  for (const encoded of [icons, JSON.stringify(icons)]) {
    const result = JSON.parse(await prepareUpload(JSON.stringify({ action: 'breakdance_upload_icons', icons: encoded, nonce: 'keep' }))());
    assert.match((typeof result.icons === 'string' ? JSON.parse(result.icons) : result.icons)[0].svgCode, /<path /);
    assert.equal(result.nonce, 'keep');
  }
  const output = await prepareUpload(new URLSearchParams({ icons: JSON.stringify(icons) }), '?action=breakdance_upload_icons')();
  assert.match(JSON.parse(output.get('icons'))[0].svgCode, /<path /);
});

test('failed batch leaves original body intact and unrelated requests untouched', async () => {
  const body = payload();
  body.set('icons[1][svgCode]', unsupported);
  await assert.rejects(prepareUpload(body)());
  assert.equal(body.get('icons[0][svgCode]'), raw);
  assert.equal(prepareUpload('action=other&icons=hello'), null);
});

test('fetch converts before sending, preserves request options and rejects failed uploads', async () => {
  const sent = [];
  window.fetch = async (...args) => { sent.push(args); return 'response'; };
  hookFetch();
  const once = window.fetch;
  hookFetch();
  assert.equal(window.fetch, once);
  const body = payload();
  const options = { method: 'POST', body, credentials: 'include' };
  assert.equal(await window.fetch('/ajax', options), 'response');
  assert.match(sent[0][1].body.get('icons[0][svgCode]'), /<path /);
  assert.equal(sent[0][1].credentials, 'include');
  assert.equal(options.body.get('icons[0][svgCode]'), raw);
  const form = new FormData();
  for (const entry of payload()) form.append(...entry);
  const multipart = new Request('https://example.test/ajax', { method: 'POST', body: form });
  await window.fetch(multipart);
  assert.match(sent[1][1].body.get('icons[0][svgCode]'), /<path /);
  assert.equal(sent[1][1].headers.has('content-type'), false);
  assert.equal(multipart.bodyUsed, false);
  const bad = payload();
  bad.set('icons[0][svgCode]', unsupported);
  const savedError = console.error;
  console.error = () => {};
  try { await assert.rejects(window.fetch('/ajax', { method: 'POST', body: bad })); }
  finally { console.error = savedError; }
  assert.equal(sent.length, 2);
  await window.fetch('/unrelated', { method: 'POST', body: 'hello' });
  assert.equal(sent[2][1].body, 'hello');
});

test.after(() => { globalThis.fetch = nativeFetch; });

test('engine initialization failures can be retried without caching raw SVGs', async () => {
  const isolated = await import('../src/breakdance.js?engine-retry');
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) return { ok: false, status: 503 };
    return { ok: true, arrayBuffer: async () => wasm };
  };
  await assert.rejects(isolated.convertIconSvg(raw), /503/);
  assert.match(await isolated.convertIconSvg(raw), /<path /);
  assert.equal(attempts, 2);
});
