# AGENTS.md — maplink

Single-page MapLibre map (React 19 + TS + Vite 8) where the URL query string is the
data API. Spec: `README.md`. Everything map-related lives in `src/App.tsx`.

## Verify

- `npm run build` runs `tsc -b && vite build` — always use it to verify; it type-checks.
- `npm run lint` runs oxlint. No tests exist.

## Gotchas (all hit before — don't regress)

- **MapLibre worker**: v6 resolves its worker via `import.meta.url` and its worker
  statically imports `maplibre-gl-shared.mjs`. Keep the `?worker&url` worker import +
  `maplibregl.setWorkerUrl(...)` at the top of `src/App.tsx`, **and** `worker.format:
  'es'` in `vite.config.ts`. A plain `?url` import copies the worker but drops the shared
  chunk (Vite never emits it), so the browser 404s it. Symptoms: "Worker failed to load",
  or "Expected a JavaScript-or-Wasm module script but the server responded with a MIME
  type of text/html" for `/assets/maplibre-gl-shared.mjs`.
- **Vercel SPA rewrite**: `vercel.json` rewrites app paths to `index.html` but excludes
  `/assets/*` and `/.well-known/*`. Without that exclusion a missing asset returns
  `index.html` with `200 text/html` instead of a 404 — the exact mask for the worker
  MIME error above.
- **Import style**: `import * as maplibregl from 'maplibre-gl'` — there is no default
  export (`TS1192` if you "fix" it).
- **StrictMode double-mount** (`src/main.tsx`): the map effect runs twice in dev. Map,
  marker, and popup setup must be idempotent with full cleanup (`marker.remove()`,
  `popup.remove()`, `map.remove()`). Never add markers inside `map.on('load')` without
  tracking them for cleanup.
- **Generic arrows in `.tsx`**: `<T>` parses as JSX — write `<T,>`.
- **No GeoJSON types installed**: use the local `GJFeature` type in `src/App.tsx`;
  don't reference the `GeoJSON` namespace.
- **Basemap warnings are cosmetic**: OpenFreeMap `liberty` + this maplibre version logs
  `highway-shield filter` / missing-sprite-image warnings. They affect basemap icons
  only, never markers. Default style is `bright`.

## Conventions

- URL param changes go in `parseDrawables` + `README.md` together — the README is the
  API contract (repeatable params, `|`-separated `key:value`, `\|`/`\:` escapes,
  malformed entries ignored, 100/type cap).
- Markers/popups are added immediately (no style dependency); GeoJSON sources/layers
  and `fitBounds` go inside `map.on('load')`. Auto-fit only when URL has no
  `center`/`zoom`.
- `#root` in `src/index.css` is intentionally full-width — the map needs it.
