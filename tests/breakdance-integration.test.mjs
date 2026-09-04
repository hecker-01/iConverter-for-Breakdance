import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import PathKitInit from 'pathkit-wasm';
import { convertSvg, isAlreadyConverted } from '../src/svg-converter.js';

const require = createRequire(import.meta.url);
const pathKit = await PathKitInit({
  wasmBinary: await readFile(require.resolve('pathkit-wasm/bin/pathkit.wasm')),
});

test('isAlreadyConverted correctly distinguishes converted vs unconverted SVGs', () => {
  const rawSvgWithShapes = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="80" height="80"/></svg>';
  assert.equal(isAlreadyConverted(rawSvgWithShapes, DOMParser), false);

  const rawSvgWithStrokes = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="100" y2="100" stroke="blue"/></svg>';
  assert.equal(isAlreadyConverted(rawSvgWithStrokes, DOMParser), false);

  const rawSvgWithColoredPath = '<svg viewBox="0 0 100 100" fill="red" xmlns="http://www.w3.org/2000/svg"><path d="M10 10L90 90Z"/></svg>';
  assert.equal(isAlreadyConverted(rawSvgWithColoredPath, DOMParser), false);

  const rawSvgWithGroups = '<svg viewBox="0 0 100 100" fill="black" xmlns="http://www.w3.org/2000/svg"><g><path d="M10 10L90 90Z"/></g></svg>';
  assert.equal(isAlreadyConverted(rawSvgWithGroups, DOMParser), false);

  const rawSvgWithExtraPathAttrs = '<svg viewBox="0 0 100 100" fill="black" xmlns="http://www.w3.org/2000/svg"><path d="M10 10L90 90Z" fill="black"/></svg>';
  assert.equal(isAlreadyConverted(rawSvgWithExtraPathAttrs, DOMParser), false);

  const convertedSvg = convertSvg(rawSvgWithShapes, pathKit, DOMParser);
  assert.equal(isAlreadyConverted(convertedSvg, DOMParser), true);

  // Invalid or non-SVG strings
  assert.equal(isAlreadyConverted('', DOMParser), false);
  assert.equal(isAlreadyConverted('<div>not svg</div>', DOMParser), false);
  assert.equal(isAlreadyConverted(null, DOMParser), false);
});

test('conversion produces clean output and avoids converting already converted icon', () => {
  const source = '<svg viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg"><circle cx="25" cy="25" r="20"/></svg>';
  assert.equal(isAlreadyConverted(source, DOMParser), false);

  const firstPass = convertSvg(source, pathKit, DOMParser);
  assert.equal(isAlreadyConverted(firstPass, DOMParser), true);
  assert.match(firstPass, /<svg viewBox="0 0 50 50" fill="black" xmlns="http:\/\/www\.w3\.org\/2000\/svg">/);
  assert.match(firstPass, /<path d="/);

  // When check is performed, already converted SVG is detected so it avoids converting again
  let convertedSecondTime = false;
  if (!isAlreadyConverted(firstPass, DOMParser)) {
    convertSvg(firstPass, pathKit, DOMParser);
    convertedSecondTime = true;
  }
  assert.equal(convertedSecondTime, false, 'Icon should not be converted more than once');
});

test('Breakdance builder integration script exports expected handlers and avoids re-conversion', async () => {
  const breakdanceSource = await readFile(new URL('../src/breakdance.js', import.meta.url), 'utf8');
  assert.match(breakdanceSource, /breakdance_upload_icons/);
  assert.doesNotMatch(breakdanceSource, /FileReader/);
  assert.match(breakdanceSource, /hookFetch/);
  assert.match(breakdanceSource, /isAlreadyConverted/);
  assert.match(breakdanceSource, /convertedCache/);
  assert.match(breakdanceSource, /convertSvg/);
});

test('Breakdance payload simulated conversion processes unconverted icons and skips converted ones', async () => {
  const icon1 = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="20"/></svg>';
  const icon2Converted = '<svg viewBox="0 0 24 24" fill="black" xmlns="http://www.w3.org/2000/svg">\n  <path d="M0 0L24 24Z"/>\n</svg>';

  const payload = [
    { name: 'icon1', slug: 'icon-1', svgCode: icon1 },
    { name: 'icon2', slug: 'icon-2', svgCode: icon2Converted },
  ];

  let convertCalls = 0;
  const processed = payload.map((item) => {
    if (isAlreadyConverted(item.svgCode, DOMParser)) {
      return item;
    }
    convertCalls++;
    return { ...item, svgCode: convertSvg(item.svgCode, pathKit, DOMParser) };
  });

  assert.equal(convertCalls, 1, 'Only icon1 should have been converted');
  assert.equal(isAlreadyConverted(processed[0].svgCode, DOMParser), true);
  assert.equal(isAlreadyConverted(processed[1].svgCode, DOMParser), true);
  assert.equal(processed[1].svgCode, icon2Converted, 'Already converted icon2 should remain unchanged');
});
