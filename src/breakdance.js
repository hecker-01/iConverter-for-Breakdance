import { convertSvg, isAlreadyConverted } from './svg-converter.js';

let pathKitPromise = null;
const convertedCache = new Set();

function getBreakdanceConfig() {
  return (typeof window !== 'undefined' && window.iconverterBreakdanceConfig) || {};
}

export function loadEngine() {
  if (pathKitPromise) return pathKitPromise;

  pathKitPromise = (async () => {
    const config = getBreakdanceConfig();
    const wasmUrl = config.wasmUrl;
    if (!wasmUrl) {
      return null;
    }

    if (typeof globalThis.PathKitInit !== 'function') {
      return null;
    }

    try {
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const wasmBinary = await response.arrayBuffer();
      const pathKit = await globalThis.PathKitInit({ wasmBinary });
      return pathKit;
    } catch (err) {
      console.warn('[iConverter] Could not initialize PathKit for Breakdance:', err);
      return null;
    }
  })();

  return pathKitPromise;
}

export async function convertIconSvg(svgSource) {
  if (typeof svgSource !== 'string' || !svgSource.trim()) return svgSource;

  if (convertedCache.has(svgSource) || isAlreadyConverted(svgSource)) {
    return svgSource;
  }

  const pathKit = await loadEngine();
  if (!pathKit) {
    return svgSource;
  }

  try {
    const converted = convertSvg(svgSource, pathKit);
    convertedCache.add(converted);
    convertedCache.add(svgSource);
    return converted;
  } catch (err) {
    console.warn('[iConverter] Icon conversion error:', err);
    if (typeof window !== 'undefined' && window.Breakdance?.NotificationLogger?.errorMessage) {
      window.Breakdance.NotificationLogger.errorMessage(
        `iConverter: Could not convert icon (${err.message || err.code || 'unsupported SVG'})`
      );
    }
    return svgSource;
  }
}

export function hookFileReader() {
  if (typeof FileReader === 'undefined') return;
  const originalReadAsText = FileReader.prototype.readAsText;

  FileReader.prototype.readAsText = function (file, encoding) {
    const isSvg = file && (
      (file.type && file.type === 'image/svg+xml') ||
      (file.name && file.name.toLowerCase().endsWith('.svg') && file.name.toLowerCase() !== 'symbol-defs.svg')
    );

    if (isSvg) {
      loadEngine();
      const originalOnLoadEnd = this.onloadend;
      const self = this;

      this.onloadend = async function (event) {
        if (typeof self.result === 'string') {
          if (!isAlreadyConverted(self.result) && !convertedCache.has(self.result)) {
            try {
              const converted = await convertIconSvg(self.result);
              Object.defineProperty(self, 'result', {
                value: converted,
                writable: true,
                configurable: true,
              });
            } catch (err) {
              console.warn('[iConverter] FileReader conversion error:', err);
            }
          }
        }
        if (typeof originalOnLoadEnd === 'function') {
          originalOnLoadEnd.call(self, event);
        }
      };
    }

    return originalReadAsText.call(this, file, encoding);
  };
}

export function hookFetch() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    if (init && init.method && init.method.toUpperCase() === 'POST' && init.body) {
      try {
        let isUploadIcons = false;
        let formData = null;

        if (init.body instanceof FormData) {
          if (init.body.get('action') === 'breakdance_upload_icons') {
            isUploadIcons = true;
            formData = init.body;
          }
        } else if (typeof init.body === 'string' && init.body.includes('breakdance_upload_icons')) {
          const params = new URLSearchParams(init.body);
          if (params.get('action') === 'breakdance_upload_icons') {
            isUploadIcons = true;
            for (const [key, value] of Array.from(params.entries())) {
              if ((key.includes('[svgCode]') || key.endsWith('.svgCode')) && typeof value === 'string') {
                if (!isAlreadyConverted(value) && !convertedCache.has(value)) {
                  const converted = await convertIconSvg(value);
                  params.set(key, converted);
                }
              }
            }
            init.body = params.toString();
          }
        }

        if (isUploadIcons && formData) {
          const entries = Array.from(formData.entries());
          for (const [key, value] of entries) {
            if ((key.includes('[svgCode]') || key.endsWith('.svgCode')) && typeof value === 'string') {
              if (!isAlreadyConverted(value) && !convertedCache.has(value)) {
                const converted = await convertIconSvg(value);
                formData.set(key, converted);
              }
            }
          }
        }
      } catch (err) {
        console.error('[iConverter] Error intercepting breakdance_upload_icons fetch:', err);
      }
    }

    return originalFetch.apply(this, arguments);
  };
}

export function initBreakdanceIntegration() {
  hookFileReader();
  hookFetch();
  loadEngine();
}

if (typeof window !== 'undefined') {
  initBreakdanceIntegration();
}
