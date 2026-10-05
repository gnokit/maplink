# mapurl — share maps via URL

A full-screen [MapLibre GL JS](https://maplibre.org/) map (React + TypeScript + Vite,
OpenFreeMap basemap) where **the URL is the API**: markers, popups, routes, zones and
radius circles are all fed through URL params — no backend, no database. Paste a link,
get the same map.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173/
npm run build    # type-check + production build
```

With no params the map shows 5 built-in Ho Man Tin parking markers as a demo fallback.

## URL API

All drawable params are **repeatable** (one per object), fields are `|`-separated
`key:value` pairs in any order. Only `lat`+`lng` are required everywhere else;
everything else is optional. Unknown keys are ignored, malformed entries are skipped,
max 100 entries per type. Escape a literal separator with a backslash (`\|`, `\:`).
Non-ASCII text just works (the browser percent-encodes it). `#` in colors must be
written as `%23`, newlines in popup text as `%0A`.

View params: `center={lat}|{lng}`, `zoom={0–22}`, `style={bright|positron|liberty}`
(default `bright`). If drawables exist and no `center`/`zoom` is given, the map
auto-fits everything.

### 1. Markers — `m` (alias: `pin`, `marker`)

Maps 1:1 to MapLibre `MarkerOptions` + `setPopup`. `element` can't cross a URL, so
`label`/`emoji` generate the badge element locally.

```
m=lat:{}|lng:{}|label:{}|emoji:{}|color:{}|scale:{}|anchor:{}|offset:{x},{y}|rotation:{}|opacity:{}|drag:{0|1}|title:{}|body:{}
```

- `anchor`: `center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right`
- `color`: any CSS color, tints the badge · `scale`: badge size multiplier
- `title`/`body`: click-popup content (HTML-escaped, `\n` → line break)
- >50 markers auto-upgrade from DOM pins to a GPU `circle` layer

Example — two parking markers:

```
?m=lat:22.315203|lng:114.181846|label:1|emoji:🏢|color:%232563eb|title:何文田停車場|body:空位 30%0A限高 1.8 米
&m=lat:22.316543|lng:114.183219|label:2|emoji:🅿️|color:%2316a34a|title:常樂街咪錶|body:空位 13／19
```

### 2. Standalone popups — `popup`

A popup card without a marker.

```
popup=lat:{}|lng:{}|title:{}|body:{}
```

Example:

```
?popup=lat:22.3193|lng:114.1694|title:香港|body:維多利亞港以北
```

### 3. Lines (routes/paths) — `line`

GeoJSON `LineString` rendered as a `line` layer. Points are `;`-separated `lat,lng`.

```
line=pts:{lat},{lng};{lat},{lng}[;…]|color:{}|width:{}|opacity:{}|title:{}|body:{}
```

Example — walking route between two car parks (click the line for details):

```
?line=pts:22.3152,114.1818;22.3131,114.1806|color:%23e11d48|width:4|title:步行 5 分鐘|body:何文田廣場 → 何文田體育館
```

### 4. Areas (zones/boundaries) — `area`

GeoJSON `Polygon` rendered as `fill` + outline `line` layers. Ring auto-closes.

```
area=pts:{lat},{lng};{lat},{lng}[;…]|color:{}|opacity:{}|outline:{}|title:{}|body:{}
```

Example — shaded estate boundary:

```
?area=pts:22.3120,114.1790;22.3120,114.1820;22.3100,114.1820;22.3100,114.1790|color:%232563eb|opacity:0.2|title:愛民邨範圍
```

### 5. Circles (radius rings) — `circle`

Center + radius in **meters**, approximated as a 64-sided polygon (same styling as areas).

```
circle=lat:{}|lng:{}|radius:{m}|color:{}|opacity:{}|title:{}|body:{}
```

Example — 500 m catchment around a car park:

```
?circle=lat:22.315203|lng:114.181846|radius:500|color:%2316a34a|opacity:0.15|title:5 分鐘步行圈
```

### Combined example

One link with a marker, a route and a zone (auto-fitted):

```
?m=lat:22.315203|lng:114.181846|emoji:🏢|title:何文田停車場|body:空位 30
&line=pts:22.3152,114.1818;22.3131,114.1806|color:%23e11d48|width:4|title:步行 5 分鐘
&area=pts:22.3120,114.1790;22.3120,114.1820;22.3100,114.1820;22.3100,114.1790|color:%232563eb|opacity:0.2|title:愛民邨範圍
```

## How it works

`src/App.tsx` parses `window.location.search` into a `DrawableSet`
(`parseDrawables`), renders DOM `Marker`s + `Popup`s immediately, and adds
GeoJSON sources/layers on map `load` with per-feature data-driven styling.
`circle()` (haversine destination) turns radius meters into polygon rings.
Cleanup removes all markers/popups/layers on unmount (StrictMode-safe).

## Stack

React 19 · TypeScript · Vite 8 · `maplibre-gl` (worker bundled via `?url` import +
`setWorkerUrl`) · OpenFreeMap vector tiles (no API key).
