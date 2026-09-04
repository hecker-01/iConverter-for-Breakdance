# iConverter for Breakdance

A minimal WordPress plugin that converts Breakdance Icon Library uploads to solid-black, path-only SVGs in the browser.

Activate the plugin, then upload icons through Breakdance as usual. Conversion runs before the upload is sent. It supports SVG shapes, strokes, transforms, and local user-space clip paths, including icons extracted by Breakdance from IcoMoon files. Repeated icons reuse the converted result. Unsupported SVGs block the upload and show an error.

## Installation

1. Download the [latest release](https://github.com/hecker-01/iconverter/releases/latest).
2. Upload the `iconverter-(version).zip` file to your WordPress plugins.
3. Activate the plugin.

## Development

```sh
npm test
npm run build
```

Installable archive: `dist/iconverter-1.0.1.zip`.
