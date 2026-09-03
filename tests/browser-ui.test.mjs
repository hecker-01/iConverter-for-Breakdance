import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const browserSource = await readFile(new URL('../src/browser.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/converter.css', import.meta.url), 'utf8');

const workerSource = await readFile(new URL('../src/converter-worker.js', import.meta.url), 'utf8');

test('shows compact progress counts instead of successful result rows', () => {
  assert.match(browserSource, /data-progress[^>]+role="progressbar"/);
  assert.match(browserSource, /data-count-queued/);
  assert.match(browserSource, /data-count-complete/);
  assert.match(browserSource, /data-count-failed/);
  assert.match(css, /\.iconverter-progress-complete/);
  assert.match(css, /\.iconverter-progress-failed/);
  assert.doesNotMatch(browserSource, /data-download="/);
});

test('does not render a redundant product label above the heading', () => {
  assert.doesNotMatch(browserSource, /iconverter-kicker/);
  assert.doesNotMatch(css, /\.iconverter-kicker/);
});

test('uses a proper download icon in the file drop zone', () => {
  assert.match(browserSource, /class="iconverter-download-icon"[\s\S]*<svg[\s\S]*M12 3v12/);
  assert.doesNotMatch(browserSource, /iconverter-upload-icon[^>]*>↑/);
  assert.doesNotMatch(browserSource, /iconverter-or|>—</);
  assert.doesNotMatch(browserSource, /strings\.limits|id}-limits/);
});

test('failure details are collapsed and contain failed rows only', () => {
  assert.match(browserSource, /data-failure-details hidden/);
  assert.match(browserSource, /failures = this\.items\.filter\(\(item\) => item\.status === 'failed'\)/);
  assert.match(browserSource, /this\.elements\.failureDetails\.hidden = !this\.detailsOpen \|\| failed === 0/);
  assert.match(browserSource, /this\.elements\.moreInfo\.hidden = failed === 0/);
});

test('uses a bounded worker pool with a main-thread fallback', () => {
  assert.match(browserSource, /class WorkerPool/);
  assert.match(browserSource, /Math\.min\(4, Math\.max\(2,/);
  assert.match(browserSource, /return loadMainThreadEngine\(\)/);
  assert.match(workerSource, /convertSvg\(data\.source, pathKit, DOMParser\)/);
  assert.match(workerSource, /type: 'result'/);
});
