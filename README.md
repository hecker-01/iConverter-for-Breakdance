# iConverter

A privacy-first WordPress SVG converter exposed through the `[icon-converter]` shortcode and integrated with Breakdance Builder. It converts supported SVG icon geometry and strokes to clean, solid-black path-only SVG files entirely in the browser.

## Converter behavior

- Accepts multiple SVG files, ZIP archives of SVGs, or both.
- Supports paths, common SVG primitives, groups, solid fills, strokes, transforms, and local user-space clip paths.
- Rejects unsupported features instead of silently changing the artwork.
- Automatically hooks into Breakdance Builder to convert icons uploaded to the Breakdance Icon Library.
- Reuses the existing browser conversion engine and avoids converting any icon more than once.
- Provides individual downloads, batch ZIP downloads, and live literal or regular-expression filename rules.
- Shows a compact progress bar with queued, completed, and failed totals.
- Keeps row details collapsed and reveals only failed files on request.
- Converts files concurrently in a browser Web Worker pool, with a single-thread fallback.
- Includes English and Dutch interface text selected by the WordPress locale.

## Development

Run the structural tests:

```sh
npm test
```

Build the installable plugin archive:

```sh
npm run build
```

The archive is created at `dist/iconverter-0.3.6.zip`.

## WordPress

Upload the generated ZIP through Plugins → Add Plugin → Upload Plugin, activate **iConverter**, and add `[icon-converter]` to a page. When using Breakdance Builder, any icons uploaded to the Breakdance Icon Library are automatically converted.
