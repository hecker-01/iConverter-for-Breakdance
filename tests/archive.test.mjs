import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { createDownloadZip, expandInputs } from '../src/archive.js';

async function makeZip(entries) {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const [name, content] of entries) await writer.add(name, new TextReader(content));
  return writer.close();
}

test('extracts nested SVG entries and ignores unrelated files', async () => {
  const blob = await makeZip([
    ['icons/one.svg', '<svg/>'],
    ['icons/nested/two.SVG', '<svg/>'],
    ['README.txt', 'ignored'],
  ]);
  const result = await expandInputs([new File([blob], 'icons.zip')]);
  assert.deepEqual(result.svgItems.map((item) => item.relativeName), ['icons/one.svg', 'icons/nested/two.SVG']);
  assert.equal(await result.svgItems[1].readText(), '<svg/>');
  assert.deepEqual(result.errors, []);
});

test('rejects nested archives and archives without SVG files', async () => {
  const nested = await makeZip([['nested.zip', 'not really a zip'], ['ok.svg', '<svg/>']]);
  const empty = await makeZip([['readme.txt', 'hello']]);
  const result = await expandInputs([new File([nested], 'nested.zip'), new File([empty], 'empty.zip')]);
  assert.deepEqual(result.errors.map((error) => error.code), ['nestedArchive', 'emptyArchive']);
  assert.equal(result.svgItems.length, 0);
});

test('does not impose file-count or byte limits', async () => {
  const manyFiles = Array.from({ length: 1001 }, (_, index) => new File(['<svg/>'], `${index}.svg`));
  const countResult = await expandInputs(manyFiles);
  assert.equal(countResult.svgItems.length, manyFiles.length);
  assert.deepEqual(countResult.errors, []);

  const formerlyOversized = { name: 'large.svg', size: 10 * 1024 * 1024 + 1, text: async () => '<svg/>' };
  const sizeResult = await expandInputs([formerlyOversized]);
  assert.equal(sizeResult.svgItems.length, 1);
  assert.deepEqual(sizeResult.errors, []);
});

test('creates a ZIP containing only successful renamed outputs', async () => {
  const blob = await createDownloadZip([
    { outputName: { relativeName: 'icons/one-black.svg' }, output: '<svg id="one"/>' },
    { outputName: { relativeName: 'two-black.svg' }, output: '<svg id="two"/>' },
  ]);
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  assert.deepEqual(entries.map((entry) => entry.filename), ['icons/one-black.svg', 'two-black.svg']);
  assert.equal(await entries[0].getData(new TextWriter()), '<svg id="one"/>');
  await reader.close();
});
