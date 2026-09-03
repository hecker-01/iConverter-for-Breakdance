import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRemoval, createOutputNames, sanitizeStem } from '../src/naming.js';

const items = [
  { relativeName: 'icons/prefix-home-icon.svg' },
  { relativeName: 'icons/prefix-home-icon.svg' },
  { relativeName: 'other/prefix-user-icon.svg' },
];

test('literal removal is global, case-sensitive, and supports prefix and suffix', () => {
  const result = createOutputNames(items, { remove: 'prefix-', prefix: 'new-', suffix: '-black' });
  assert.equal(result.error, null);
  assert.deepEqual(result.names.map((item) => item.relativeName), [
    'icons/new-home-icon-black.svg',
    'icons/new-home-icon-black-2.svg',
    'other/new-user-icon-black.svg',
  ]);
});

test('regex removal applies all matches without slash delimiters', () => {
  const result = createOutputNames([{ relativeName: 'icon-12-test-34.svg' }], { remove: '-\\d+', useRegex: true });
  assert.equal(result.names[0].basename, 'icon-test.svg');
});

test('invalid regex is reported without names', () => {
  const result = createOutputNames(items, { remove: '[', useRegex: true });
  assert.ok(result.error);
  assert.deepEqual(result.names, []);
  assert.ok(compileRemoval('[', true).error);
});

test('empty, unsafe, reserved, and colliding names are normalized', () => {
  assert.equal(sanitizeStem(''), 'converted');
  assert.equal(sanitizeStem('CON'), '_CON');
  assert.equal(sanitizeStem('bad<name>. '), 'bad-name-');
  const result = createOutputNames([{ relativeName: 'a.svg' }, { relativeName: 'A.svg' }], { remove: 'a' });
  assert.deepEqual(result.names.map((item) => item.basename), ['converted.svg', 'A.svg']);
});
