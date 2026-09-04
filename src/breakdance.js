import { convertSvg, isAlreadyConverted } from './svg-converter.js';

let pathKitPromise = null;
const convertedCache = new Map();
const hooked = new WeakSet();
const uploadAction = 'breakdance_upload_icons';

export function loadEngine() {
  if (!pathKitPromise) {
    pathKitPromise = (async () => {
      const wasmUrl = globalThis.window?.iconverterBreakdanceConfig?.wasmUrl;
      if (!wasmUrl || typeof globalThis.PathKitInit !== 'function') {
        throw new Error('SVG conversion engine is unavailable');
      }
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return globalThis.PathKitInit({ wasmBinary: await response.arrayBuffer() });
    })().catch((error) => {
      pathKitPromise = null;
      throw error;
    });
  }
  return pathKitPromise;
}

export async function convertIconSvg(svgSource) {
  if (typeof svgSource !== 'string' || !svgSource.trim()) {
    throw new Error('Icon SVG is empty');
  }
  if (isAlreadyConverted(svgSource)) return svgSource;
  if (!convertedCache.has(svgSource)) {
    const pending = loadEngine().then((engine) => convertSvg(svgSource, engine)).catch((error) => {
      convertedCache.delete(svgSource);
      throw error;
    });
    convertedCache.set(svgSource, pending);
  }
  return convertedCache.get(svgSource);
}

function reportError(error) {
  const reason = error.code === 'unsupportedElement' ? `Unsupported SVG element: ${error.detail}` : error.message || 'unsupported SVG';
  const message = `iConverter: Could not upload icons (${reason})`;
  console.error(message, error);
  globalThis.window?.Breakdance?.NotificationLogger?.log?.errorMessage?.(message);
}

async function convertIcons(icons) {
  if (!icons || typeof icons !== 'object') throw new Error('Invalid icon payload');
  const result = Array.isArray(icons) ? [] : {};
  for (const [key, icon] of Object.entries(icons)) {
    result[key] = icon && typeof icon === 'object' && 'svgCode' in icon
      ? { ...icon, svgCode: await convertIconSvg(icon.svgCode) }
      : icon;
  }
  return result;
}

// Return null for unrelated traffic; copy payloads so failures cannot partially mutate them.
export function prepareUpload(body, url = '') {
  let urlAction;
  try { urlAction = new URL(url, globalThis.location?.href || 'http://localhost').searchParams.get('action'); } catch { /* Not a URL. */ }
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  const params = body instanceof URLSearchParams;
  let data;
  let json = false;
  if (form || params) data = body;
  else if (typeof body === 'string') {
    try {
      data = JSON.parse(body);
      json = data !== null && typeof data === 'object';
    } catch { /* Form encoded body. */ }
    if (!json) data = new URLSearchParams(body);
  } else return null;
  const action = json ? data.action : data.get('action');
  if ((action || urlAction) !== uploadAction) return null;

  return async () => {
    if (json) {
      if (!('icons' in data)) throw new Error('Missing icons in upload');
      const icons = typeof data.icons === 'string' ? JSON.parse(data.icons) : data.icons;
      const converted = await convertIcons(icons);
      return JSON.stringify({ ...data, icons: typeof data.icons === 'string' ? JSON.stringify(converted) : converted });
    }
    const output = form ? new FormData() : new URLSearchParams();
    let found = false;
    for (const [key, value] of data.entries()) {
      let converted = value;
      if (/^icons(?:\[[^\]]+\]\[svgCode\]|\.[^.]+\.svgCode)$/.test(key)) {
        converted = await convertIconSvg(value);
        found = true;
      } else if (key === 'icons' && typeof value === 'string') {
        converted = JSON.stringify(await convertIcons(JSON.parse(value)));
        found = true;
      }
      output.append(key, converted);
    }
    if (!found) throw new Error('Missing icons in upload');
    return form || params ? output : output.toString();
  };
}

export function hookFetch() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function' || hooked.has(window)) return;
  hooked.add(window);
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const request = typeof Request !== 'undefined' && input instanceof Request;
    const method = init?.method || (request ? input.method : 'GET');
    if (method.toUpperCase() !== 'POST') return originalFetch.call(this, input, init);
    try {
      let body = init?.body;
      if (body == null && request) {
        const type = input.headers.get('content-type') || '';
        body = type.includes('multipart/form-data') ? await input.clone().formData() : await input.clone().text();
      }
      const convert = prepareUpload(body, request ? input.url : String(input));
      if (!convert) return originalFetch.call(this, input, init);
      const converted = await convert();
      const options = { ...init, body: converted };
      // A cloned multipart body gets a new boundary from the browser.
      if (typeof FormData !== 'undefined' && converted instanceof FormData) {
        options.headers = new Headers(init?.headers || (request ? input.headers : undefined));
        options.headers.delete('content-type');
      }
      return originalFetch.call(this, input, options);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };
}

export function initBreakdanceIntegration() {
  hookFetch();
}

if (typeof window !== 'undefined') initBreakdanceIntegration();
