import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import PathKitInit from 'pathkit-wasm';
import { ConversionError, convertSvg, parseTransform } from '../src/svg-converter.js';

const require = createRequire(import.meta.url);
const pathKit = await PathKitInit({
  wasmBinary: await readFile(require.resolve('pathkit-wasm/bin/pathkit.wasm')),
});

function convert(body, root = 'viewBox="0 0 100 100"') {
  return convertSvg(`<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`, pathKit, DOMParser);
}

function parseOutput(output) {
  return new DOMParser().parseFromString(output, 'image/svg+xml');
}

test('converts every supported primitive to path-only output', () => {
  const output = convert(`
    <rect x="1" y="2" width="10" height="12" rx="2"/>
    <circle cx="20" cy="20" r="5"/>
    <ellipse cx="35" cy="20" rx="5" ry="3"/>
    <line x1="0" y1="30" x2="10" y2="30" stroke="red"/>
    <polyline points="20,30 25,35 30,30" fill="none" stroke="blue"/>
    <polygon points="40,30 50,30 45,40"/>
  `);
  const document = parseOutput(output);
  assert.equal(document.documentElement.nodeName, 'svg');
  assert.equal(document.getElementsByTagName('path').length, 6);
  assert.equal(document.getElementsByTagName('*').length, 7);
});

test('bakes inherited styles and nested transforms into coordinates', () => {
  const output = convert('<g fill="red" transform="translate(10 5)"><g transform="scale(2)"><rect width="5" height="5"/></g></g>');
  assert.match(output, /M10 5L20 5L20 15L10 15/);
  assert.doesNotMatch(output, /transform|<g|fill="red"/);
});

test('outlines strokes and emits separate fill and stroke paths', () => {
  const output = convert('<path d="M10 10L40 10" fill="black" stroke="red" stroke-width="4" stroke-linecap="round"/>');
  assert.equal(parseOutput(output).getElementsByTagName('path').length, 2);
  assert.doesNotMatch(output, /stroke=/);
});

test('rewrites evenodd holes as nonzero winding geometry', () => {
  const output = convert('<path fill-rule="evenodd" d="M0 0H80V80H0ZM20 20H60V60H20Z"/>');
  assert.doesNotMatch(output, /fill-rule/);
  assert.match(output, /<path d="[^"]+Z[^"]+Z"\/>/);
});

test('preserves valid viewBox and derives one from numeric dimensions', () => {
  assert.match(convert('<rect width="1" height="1"/>'), /viewBox="0 0 100 100"/);
  const derived = convert('<rect width="24" height="12"/>', 'width="24px" height="12"');
  assert.match(derived, /viewBox="0 0 24 12"/);
  assert.doesNotMatch(derived, /width=|height=/);
});

test('output has exactly the permitted structure and attributes', () => {
  const document = parseOutput(convert('<rect id="box" width="10" height="10" fill="#f00"/>'));
  const root = document.documentElement;
  assert.deepEqual(Array.from(root.attributes).map((attribute) => attribute.name).sort(), ['fill', 'viewBox', 'xmlns'].sort());
  for (const path of Array.from(document.getElementsByTagName('path'))) {
    assert.deepEqual(Array.from(path.attributes).map((attribute) => attribute.name), ['d']);
  }
});

test('supports the standard SVG transform functions', () => {
  for (const value of [
    'matrix(1 0 0 1 5 6)',
    'translate(2,3) scale(2)',
    'rotate(45)',
    'rotate(45 10 10)',
    'skewX(10)',
    'skewY(-10)',
  ]) assert.equal(parseTransform(value).length, 6);
  assert.throws(() => parseTransform('rotate(nope)'), ConversionError);
});

test('skips fully hidden geometry', () => {
  const output = convert('<g display="none"><rect width="10" height="10"/></g><circle cx="20" cy="20" r="3"/>');
  assert.equal(parseOutput(output).getElementsByTagName('path').length, 1);
});

test('bakes local clip-path references into output geometry', () => {
  const output = convert(`
    <defs><clipPath id="left"><rect width="40" height="100"/></clipPath></defs>
    <rect width="100" height="100" clip-path="url(#left)"/>
  `);
  assert.match(output, /M0 0L40 0L40 100L0 100/);
  assert.doesNotMatch(output, /clip-path|clipPath|<defs/);
});

test('supports clip-path in styles and applies group transforms once', () => {
  const output = convert(`
    <defs><clipPath id="window"><rect width="5" height="10"/></clipPath></defs>
    <g transform="translate(10 20)" style="clip-path: url('#window')">
      <rect width="20" height="10"/>
    </g>
  `);
  assert.match(output, /M10 20L15 20L15 30L10 30/);
});

test('intersects nested clips and unions multiple clip shapes', () => {
  const output = convert(`
    <defs>
      <clipPath id="two-bars">
        <rect width="20" height="10"/>
        <rect y="20" width="20" height="10"/>
      </clipPath>
      <clipPath id="right"><rect x="10" width="20" height="30"/></clipPath>
    </defs>
    <g clip-path="url(#two-bars)">
      <rect width="30" height="30" clip-path="url(#right)"/>
    </g>
  `);
  assert.equal(parseOutput(output).getElementsByTagName('path').length, 1);
  assert.match(output, /M10 0L10 10L20 10L20 0L10 0Z/);
  assert.match(output, /M20 30L20 20L10 20L10 30L20 30Z/);
});

test('rejects missing, external, and unsupported object-bounding-box clips', () => {
  for (const [body, code] of [
    ['<rect width="10" height="10" clip-path="url(#missing)"/>', 'invalidAttribute'],
    ['<rect width="10" height="10" clip-path="url(https://example.com/a.svg#clip)"/>', 'externalReference'],
    ['<defs><clipPath id="clip" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath></defs><rect width="10" height="10" clip-path="url(#clip)"/>', 'unsupportedAttribute'],
  ]) {
    assert.throws(() => convert(body), (error) => error instanceof ConversionError && error.code === code);
  }
});

test('rejects unsupported and unsafe SVG features per file', () => {
  const cases = [
    ['<text>Hi</text>', 'unsupportedElement'],
    ['<image href="https://example.com/x.png"/>', 'externalReference'],
    ['<path d="M0 0L1 1" stroke="black" stroke-dasharray="2 2" fill="none"/>', 'dashedStroke'],
    ['<rect width="10" height="10" opacity=".5"/>', 'partialOpacity'],
    ['<path d="M0 0" vector-effect="non-scaling-stroke"/>', 'unsupportedAttribute'],
    ['<style>path{fill:red}</style>', 'unsupportedElement'],
    ['<script>alert(1)</script>', 'unsupportedElement'],
    ['<path d="M0 nope"/>', 'invalidPath'],
  ];
  for (const [body, code] of cases) {
    assert.throws(
      () => convert(body),
      (error) => error instanceof ConversionError && error.code === code,
      body,
    );
  }
  assert.throws(
    () => convertSvg('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>', pathKit, DOMParser),
    (error) => error.code === 'unsafeContent',
  );
});
