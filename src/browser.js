import { createDownloadZip, expandInputs } from './archive.js';
import { createOutputNames } from './naming.js';
import { ConversionError, convertSvg } from './svg-converter.js';

const configElement = document.querySelector('[data-iconverter-config]');
let config = { strings: {}, wasmUrl: '' };
try {
  if (configElement) config = JSON.parse(configElement.textContent);
} catch {
  // The visible initialization error below handles malformed configuration.
}
const strings = config.strings || {};
let executorPromise;

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function format(template, ...values) {
  let output = String(template || '');
  values.forEach((value, index) => {
    output = output.replaceAll(`%${index + 1}$d`, value).replace('%s', value);
  });
  return output;
}

function loadMainThreadEngine() {
  return fetch(config.wasmUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`WASM request failed with ${response.status}`);
        return response.arrayBuffer();
      })
      .then((wasmBinary) => globalThis.PathKitInit({ wasmBinary }))
      .then((pathKit) => ({
        concurrency: 1,
        convert: async (source) => convertSvg(source, pathKit),
      }));
}

class WorkerPool {
  constructor(size) {
    this.concurrency = size;
    this.nextJobId = 0;
    this.queue = [];
    this.jobs = new Map();
    this.workers = [];
  }

  static async create(size) {
    const pool = new WorkerPool(size);
    await Promise.all(Array.from({ length: size }, () => pool.addWorker()));
    return pool;
  }

  addWorker() {
    return new Promise((resolve, reject) => {
      const slot = { worker: new Worker(config.workerUrl), busy: false };
      this.workers.push(slot);
      const fail = (message) => reject(new Error(message || 'Worker initialization failed'));
      slot.worker.addEventListener('error', (event) => fail(event.message), { once: true });
      slot.worker.addEventListener('message', ({ data }) => {
        if (data.type === 'ready') {
          resolve();
          return;
        }
        if (data.type === 'initialization-error') {
          fail(data.message);
          return;
        }
        if (data.type !== 'result') return;
        const job = this.jobs.get(data.id);
        if (!job) return;
        this.jobs.delete(data.id);
        slot.busy = false;
        if (data.error) job.reject(Object.assign(new Error(data.error.detail || data.error.code), data.error));
        else job.resolve(data.output);
        this.pump();
      });
      slot.worker.postMessage({
        type: 'initialize',
        pathkitUrl: config.pathkitUrl,
        wasmUrl: config.wasmUrl,
      });
    });
  }

  convert(source) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.nextJobId, source, resolve, reject });
      this.pump();
    });
  }

  pump() {
    for (const slot of this.workers) {
      if (slot.busy || !this.queue.length) continue;
      const job = this.queue.shift();
      slot.busy = true;
      this.jobs.set(job.id, job);
      slot.worker.postMessage({ type: 'convert', id: job.id, source: job.source });
    }
  }

  terminate() {
    this.workers.forEach(({ worker }) => worker.terminate());
  }
}

async function createExecutor() {
  if (globalThis.Worker && config.workerUrl && config.pathkitUrl) {
    const size = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 2) - 1));
    let pool;
    try {
      pool = await WorkerPool.create(size);
      return pool;
    } catch {
      pool?.terminate();
    }
  }
  return loadMainThreadEngine();
}

function loadExecutor() {
  if (!executorPromise) executorPromise = createExecutor();
  return executorPromise;
}

function appMarkup(id) {
  return `
    <section class="iconverter-shell" aria-labelledby="${id}-heading">
      <header class="iconverter-header">
        <h2 id="${id}-heading">${html(strings.heading)}</h2>
        <p>${html(strings.intro)}</p>
      </header>
      <div class="iconverter-dropzone" data-dropzone role="group" aria-labelledby="${id}-drop-label">
        <span class="iconverter-download-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
            <path d="M12 3v12"/>
            <path d="m7 10 5 5 5-5"/>
            <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>
          </svg>
        </span>
        <strong id="${id}-drop-label">${html(strings.dropLabel)}</strong>
        <button class="iconverter-button iconverter-button-primary" type="button" data-browse>${html(strings.browse)}</button>
        <input class="iconverter-file-input" data-input type="file" accept=".svg,.zip,image/svg+xml,application/zip" multiple>
      </div>
      <div class="iconverter-rename" data-rename hidden>
        <h3>${html(strings.renameHeading)}</h3>
        <div class="iconverter-fields">
          <label class="iconverter-field iconverter-field-remove">
            <span>${html(strings.removeLabel)}</span>
            <input type="text" data-remove placeholder="${html(strings.removePlaceholder)}" autocomplete="off">
          </label>
          <label class="iconverter-check">
            <input type="checkbox" data-regex>
            <span>${html(strings.regexLabel)}</span>
          </label>
          <label class="iconverter-field">
            <span>${html(strings.prefixLabel)}</span>
            <input type="text" data-prefix placeholder="${html(strings.prefixPlaceholder)}" autocomplete="off">
          </label>
          <label class="iconverter-field">
            <span>${html(strings.suffixLabel)}</span>
            <input type="text" data-suffix placeholder="${html(strings.suffixPlaceholder)}" autocomplete="off">
          </label>
        </div>
        <p class="iconverter-error" data-regex-error role="alert" hidden></p>
      </div>
      <div class="iconverter-results" data-results hidden>
        <div class="iconverter-summary">
          <div class="iconverter-progress-label">
            <strong>${html(strings.progress)}</strong>
            <span data-progress-text></span>
          </div>
          <div class="iconverter-progress" data-progress role="progressbar" aria-label="${html(strings.progress)}" aria-valuemin="0" aria-valuenow="0" aria-valuemax="0">
            <span class="iconverter-progress-complete" data-progress-complete></span>
            <span class="iconverter-progress-failed" data-progress-failed></span>
          </div>
          <div class="iconverter-counts">
            <span class="iconverter-count iconverter-count-queued"><i aria-hidden="true"></i>${html(strings.queued)} <strong data-count-queued>0</strong></span>
            <span class="iconverter-count iconverter-count-complete"><i aria-hidden="true"></i>${html(strings.complete)} <strong data-count-complete>0</strong></span>
            <span class="iconverter-count iconverter-count-failed"><i aria-hidden="true"></i>${html(strings.failed)} <strong data-count-failed>0</strong></span>
            <button class="iconverter-link iconverter-more-info" type="button" data-more-info aria-expanded="false" hidden>${html(strings.moreInfo)}</button>
          </div>
        </div>
        <div class="iconverter-failure-details" data-failure-details hidden>
          <div class="iconverter-table-wrap">
          <table>
            <thead><tr>
              <th>${html(strings.sourceName)}</th>
              <th>${html(strings.failureReason)}</th>
            </tr></thead>
            <tbody data-rows></tbody>
          </table>
          </div>
        </div>
        <div class="iconverter-toolbar">
          <button class="iconverter-button iconverter-button-primary" type="button" data-download-all hidden>${html(strings.downloadAll)}</button>
          <button class="iconverter-button" type="button" data-retry hidden>${html(strings.retry)}</button>
          <button class="iconverter-button iconverter-button-quiet" type="button" data-clear>${html(strings.clear)}</button>
        </div>
      </div>
      <p class="iconverter-live" data-live aria-live="polite" aria-atomic="true"></p>
    </section>`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

class ConverterApp {
  constructor(root, executor) {
    this.root = root;
    this.executor = executor;
    this.items = [];
    this.busy = false;
    this.detailsOpen = false;
    this.id = root.id || `iconverter-${Math.random().toString(36).slice(2)}`;
    root.innerHTML = appMarkup(this.id);
    this.elements = {
      input: root.querySelector('[data-input]'),
      browse: root.querySelector('[data-browse]'),
      dropzone: root.querySelector('[data-dropzone]'),
      rename: root.querySelector('[data-rename]'),
      remove: root.querySelector('[data-remove]'),
      regex: root.querySelector('[data-regex]'),
      prefix: root.querySelector('[data-prefix]'),
      suffix: root.querySelector('[data-suffix]'),
      regexError: root.querySelector('[data-regex-error]'),
      results: root.querySelector('[data-results]'),
      rows: root.querySelector('[data-rows]'),
      progress: root.querySelector('[data-progress]'),
      progressText: root.querySelector('[data-progress-text]'),
      progressComplete: root.querySelector('[data-progress-complete]'),
      progressFailed: root.querySelector('[data-progress-failed]'),
      countQueued: root.querySelector('[data-count-queued]'),
      countComplete: root.querySelector('[data-count-complete]'),
      countFailed: root.querySelector('[data-count-failed]'),
      moreInfo: root.querySelector('[data-more-info]'),
      failureDetails: root.querySelector('[data-failure-details]'),
      downloadAll: root.querySelector('[data-download-all]'),
      retry: root.querySelector('[data-retry]'),
      clear: root.querySelector('[data-clear]'),
      live: root.querySelector('[data-live]'),
    };
    this.bind();
  }

  bind() {
    const { input, browse, dropzone, remove, regex, prefix, suffix, downloadAll, retry, clear, moreInfo } = this.elements;
    browse.addEventListener('click', (event) => {
      event.stopPropagation();
      input.click();
    });
    dropzone.addEventListener('click', (event) => {
      if (event.target !== browse && event.target !== input) input.click();
    });
    input.addEventListener('change', () => this.loadFiles(input.files));
    for (const type of ['dragenter', 'dragover']) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add('is-dragging');
      });
    }
    for (const type of ['dragleave', 'drop']) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove('is-dragging');
      });
    }
    dropzone.addEventListener('drop', (event) => this.loadFiles(event.dataTransfer.files));
    for (const field of [remove, regex, prefix, suffix]) field.addEventListener('input', () => this.refreshNames());
    downloadAll.addEventListener('click', () => this.downloadAll());
    retry.addEventListener('click', () => this.retryFailed());
    clear.addEventListener('click', () => this.clear());
    moreInfo.addEventListener('click', () => {
      this.detailsOpen = !this.detailsOpen;
      this.render();
    });
  }

  async loadFiles(fileList) {
    if (this.busy || !fileList?.length) return;
    this.clear();
    this.busy = true;
    this.elements.live.textContent = strings.loading;
    try {
      const { svgItems, errors } = await expandInputs([...fileList]);
      this.items = svgItems.map((item, index) => ({
        ...item,
        id: `${Date.now()}-${index}`,
        status: 'queued',
        output: null,
        error: null,
        convertible: true,
      }));
      errors.forEach((error, index) => {
        this.items.push({
          id: `error-${Date.now()}-${index}`,
          name: error.name,
          relativeName: error.name,
          status: 'failed',
          output: null,
          error: { code: error.code },
          convertible: false,
        });
      });
      this.refreshNames();
      this.render();
      await this.process(this.items.filter((item) => item.convertible));
    } finally {
      this.busy = false;
      this.elements.input.value = '';
      this.render();
      this.announce();
    }
  }

  async process(items) {
    let cursor = 0;
    const runNext = async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        item.status = 'converting';
        item.error = null;
        this.render();
        try {
          const source = await item.readText();
          item.output = await this.executor.convert(source);
          item.status = 'complete';
        } catch (error) {
          item.output = null;
          item.status = 'failed';
          item.error = error instanceof ConversionError || error.code
            ? { code: error.code, detail: error.detail }
            : { code: 'invalidPath', detail: error.message };
        }
        this.render();
      }
    };
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await Promise.all(Array.from(
      { length: Math.min(this.executor.concurrency, items.length) },
      () => runNext(),
    ));
  }

  refreshNames() {
    const convertible = this.items.filter((item) => item.convertible);
    const result = createOutputNames(convertible, {
      remove: this.elements.remove.value,
      useRegex: this.elements.regex.checked,
      prefix: this.elements.prefix.value,
      suffix: this.elements.suffix.value,
    });
    this.renameError = result.error;
    convertible.forEach((item, index) => { item.outputName = result.error ? null : result.names[index]; });
    this.elements.regexError.hidden = !result.error;
    this.elements.regexError.textContent = result.error ? format(strings.invalidRegex, result.error) : '';
    this.render();
  }

  errorText(item) {
    if (!item.error) return '';
    const base = strings[item.error.code] || item.error.code;
    return item.error.detail ? `${base} (${item.error.detail})` : base;
  }

  render() {
    const hasItems = this.items.length > 0;
    this.elements.rename.hidden = !hasItems;
    this.elements.results.hidden = !hasItems;
    const failures = this.items.filter((item) => item.status === 'failed');
    const complete = this.items.filter((item) => item.status === 'complete').length;
    const queued = this.items.filter((item) => item.status === 'queued' || item.status === 'converting').length;
    const failed = failures.length;
    const total = this.items.length;
    const processed = complete + failed;
    this.elements.progress.setAttribute('aria-valuenow', processed);
    this.elements.progress.setAttribute('aria-valuemax', total);
    this.elements.progress.setAttribute('aria-valuetext', format(strings.processed, processed, total));
    this.elements.progressText.textContent = format(strings.processed, processed, total);
    this.elements.progressComplete.style.width = total ? `${(complete / total) * 100}%` : '0%';
    this.elements.progressFailed.style.width = total ? `${(failed / total) * 100}%` : '0%';
    this.elements.countQueued.textContent = queued;
    this.elements.countComplete.textContent = complete;
    this.elements.countFailed.textContent = failed;
    this.elements.moreInfo.hidden = failed === 0;
    this.elements.moreInfo.textContent = this.detailsOpen ? strings.hideInfo : strings.moreInfo;
    this.elements.moreInfo.setAttribute('aria-expanded', String(this.detailsOpen && failed > 0));
    this.elements.failureDetails.hidden = !this.detailsOpen || failed === 0;
    this.elements.rows.innerHTML = failures.map((item) => `<tr class="status-failed">
      <td data-label="${html(strings.sourceName)}"><span class="iconverter-name">${html(item.relativeName)}</span></td>
      <td data-label="${html(strings.failureReason)}"><small class="iconverter-row-error">${html(this.errorText(item))}</small></td>
    </tr>`).join('');
    const successes = this.items.filter((item) => item.status === 'complete' && item.output);
    const retryable = this.items.some((item) => item.convertible && item.status === 'failed');
    this.elements.downloadAll.hidden = successes.length === 0;
    this.elements.downloadAll.textContent = successes.length === 1 ? strings.download : strings.downloadAll;
    this.elements.downloadAll.disabled = Boolean(this.renameError) || this.busy;
    this.elements.retry.hidden = !retryable;
    this.elements.retry.disabled = this.busy;
    this.elements.clear.disabled = this.busy;
  }

  announce() {
    const completed = this.items.filter((item) => item.status === 'complete').length;
    const failed = this.items.filter((item) => item.status === 'failed').length;
    this.elements.live.textContent = format(strings.completedAnnouncement, completed, failed);
  }

  async retryFailed() {
    if (this.busy) return;
    const failed = this.items.filter((item) => item.convertible && item.status === 'failed');
    if (!failed.length) return;
    this.busy = true;
    try {
      await this.process(failed);
    } finally {
      this.busy = false;
      this.render();
      this.announce();
    }
  }

  async downloadAll() {
    if (this.renameError || this.busy) return;
    const completed = this.items.filter((item) => item.status === 'complete' && item.output && item.outputName);
    if (!completed.length) return;
    this.busy = true;
    this.render();
    try {
      if (completed.length === 1) {
        triggerDownload(
          new Blob([completed[0].output], { type: 'image/svg+xml;charset=utf-8' }),
          completed[0].outputName.basename,
        );
      } else {
        triggerDownload(await createDownloadZip(completed), 'converted-svgs.zip');
      }
    } finally {
      this.busy = false;
      this.render();
    }
  }

  clear(render = true) {
    this.items = [];
    this.renameError = null;
    this.detailsOpen = false;
    this.elements.remove.value = '';
    this.elements.regex.checked = false;
    this.elements.prefix.value = '';
    this.elements.suffix.value = '';
    this.elements.regexError.hidden = true;
    this.elements.live.textContent = '';
    if (render) this.render();
  }
}

async function initialize() {
  const roots = [...document.querySelectorAll('[data-iconverter]')];
  if (!roots.length) return;
  try {
    const executor = await loadExecutor();
    roots.forEach((root) => new ConverterApp(root, executor));
  } catch (error) {
    console.error('iConverter:', error);
    roots.forEach((root) => {
      root.innerHTML = `<p class="iconverter-error" role="alert">${html(strings.loadFailure)}</p>`;
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
else initialize();
