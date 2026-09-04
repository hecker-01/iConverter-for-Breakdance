import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { DOMParser } from '@xmldom/xmldom';
import PathKitInit from 'pathkit-wasm';
import { convertSvg, isAlreadyConverted } from '../src/svg-converter.js';

const require = createRequire(import.meta.url);
const pathKit = await PathKitInit({
  wasmBinary: await readFile(require.resolve('pathkit-wasm/bin/pathkit.wasm')),
});

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const input = Buffer.concat(chunks).toString('utf8');

if (isAlreadyConverted(input, DOMParser)) {
  process.stdout.write(input);
} else {
  const output = convertSvg(input, pathKit, DOMParser);
  process.stdout.write(output);
}
