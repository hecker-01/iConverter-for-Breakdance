import { DOMParser } from '@xmldom/xmldom';
import { ConversionError, convertSvg } from './svg-converter.js';

let enginePromise;

function loadEngine({ pathkitUrl, wasmUrl }) {
  if (!enginePromise) {
    importScripts(pathkitUrl);
    enginePromise = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`WASM request failed with ${response.status}`);
        return response.arrayBuffer();
      })
      .then((wasmBinary) => globalThis.PathKitInit({ wasmBinary }));
  }
  return enginePromise;
}

self.addEventListener('message', async ({ data }) => {
  if (data.type === 'initialize') {
    try {
      await loadEngine(data);
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'initialization-error', message: error.message });
    }
    return;
  }

  if (data.type !== 'convert') return;
  try {
    const pathKit = await enginePromise;
    const output = convertSvg(data.source, pathKit, DOMParser);
    self.postMessage({ type: 'result', id: data.id, output });
  } catch (error) {
    self.postMessage({
      type: 'result',
      id: data.id,
      error: error instanceof ConversionError
        ? { code: error.code, detail: error.detail }
        : { code: 'invalidPath', detail: error.message },
    });
  }
});
