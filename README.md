# 🗺️ maplink

**Share a map by sharing a link. The URL _is_ the API.**

![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)
![TypeScript 6](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white)
![Vite 8](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)
![MapLibre GL 6](https://img.shields.io/badge/MapLibre_GL-6-396cb2)
![No backend](https://img.shields.io/badge/backend-none-16a34a)

A full-screen [MapLibre GL JS](https://maplibre.org/) map where markers, popups,
routes, zones and radius rings are declared **entirely in the query string**. No
backend, no database, no account — paste the link and you get the same map.

```text
https://maplink.app/?m=lat:22.315203|lng:114.181846|emoji:🏢|title:何文田停車場|body:空位 30
&circle=lat:22.315203|lng:114.181846|radius:500|color:%2316a34a|opacity:0.15
```

That link drops a parking pin and shades a 500 m walking ring around it. Swap
`maplink.app` for wherever you deploy — every example below is just a query
string to append to that URL.

## ✨ Why it's nice

- **Link = state.** Reload, bookmark, share or embed it — the map comes back identical.
- **Nothing to host.** No backend, no API key. Basemaps come from [OpenFreeMap](https://openfreemap.org/) vector tiles.
- **One file of logic.** The entire map lives in [`src/App.tsx`](src/App.tsx).
- **It scales.** Past 50 markers, DOM pins automatically upgrade to a GPU `circle` layer.

## 🚀 Run it

```sh
npm install
npm run dev      # http://localhost:5173/
npm run build    # type-check + production build
```

With no params at all, the map falls back to five built-in Ho Man Tin parking
markers as a demo.

## 📖 URL API

### The ground rules

- **Repeatable** — each drawable param may appear many times; one object per occurrence.
- **Field syntax** — `key:value` pairs joined by `|`, in any order.
- **Required** — `lat` + `lng` for `m` / `popup` / `circle`; `pts` for `line` / `area`.
- **Forgiving** — unknown keys are ignored and malformed entries are skipped, never errored.
- **Limit** — 100 entries per type.
- **Escaping** — write a literal separator as `\|` or `\:`. Popup text is HTML-escaped.
- **Encoding** — non-ASCII just works; only `#` → `%23` and newline → `%0A` need hand-encoding.

### Viewport

```text
center={lat}|{lng}   zoom={0–22}   style={bright|positron|liberty}
```

| Param | Meaning | Default |
| --- | --- | --- |
| `center` | Initial map center | Ho Man Tin, Hong Kong |
| `zoom` | Zoom level, `0`–`22` | `14.5` |
| `style` | Basemap: `bright`, `positron` or `liberty` | `bright` |

If drawables exist and no `center` / `zoom` is given, the map **auto-fits
everything**.

---

### 1. Markers — `m` (alias `pin`, `marker`)

Maps 1:1 to MapLibre `MarkerOptions` + `setPopup`. An `element` can't cross a URL,
so `label` / `emoji` generate the badge locally.

```text
m=lat:{}|lng:{}|label:{}|emoji:{}|color:{}|scale:{}|anchor:{}|offset:{x},{y}|rotation:{}|opacity:{}|drag:{0|1}|title:{}|body:{}
```

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `lat` `lng` | number | — | required |
| `label` | text | — | badge text |
| `emoji` | text | — | badge glyph, used when there's no `label` |
| `color` | CSS color | `#2563eb` | tints the badge |
| `scale` | number > 0 | `1` | badge size multiplier |
| `anchor` | enum | `center` | `center`, `top`, `bottom`, `left`, `right`, or a corner (`top-left`, …) |
| `offset` | `x,y` px | `0,0` | pixel offset from the point |
| `rotation` | degrees | `0` | rotates the badge |
| `opacity` | `0`–`1` | `1` | badge opacity |
| `drag` | `0` / `1` | `0` | let the user drag the pin |
| `title` `body` | text | — | click-popup content (`\n` → line break) |

> Over **50 markers** renders as a GPU `circle` layer instead of DOM pins.

**Two parking markers:**

```text
?m=lat:22.315203|lng:114.181846|label:1|emoji:🏢|color:%232563eb|title:何文田停車場|body:空位 30%0A限高 1.8 米
&m=lat:22.316543|lng:114.183219|label:2|emoji:🅿️|color:%2316a34a|title:常樂街咪錶|body:空位 13／19
```

### 2. Standalone popups — `popup`

A popup card with no marker under it.

```text
popup=lat:{}|lng:{}|title:{}|body:{}
```

| Key | Type | Notes |
| --- | --- | --- |
| `lat` `lng` | number | required |
| `title` `body` | text | at least one is required, else the popup is skipped |

**A label over Victoria Harbour:**

```text
?popup=lat:22.3193|lng:114.1694|title:香港|body:維多利亞港以北
```

### 3. Lines (routes / paths) — `line`

A GeoJSON `LineString` rendered as a `line` layer. Points are `;`-separated `lat,lng`.

```text
line=pts:{lat},{lng};{lat},{lng}[;…]|color:{}|width:{}|opacity:{}|title:{}|body:{}
```

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `pts` | `lat,lng` list | — | required, at least 2 points |
| `color` | CSS color | `#e11d48` | |
| `width` | number | `4` | line width in px |
| `opacity` | `0`–`1` | `1` | |
| `title` `body` | text | — | click-popup content |

**A walking route (click the line for details):**

```text
?line=pts:22.3152,114.1818;22.3131,114.1806|color:%23e11d48|width:4|title:步行 5 分鐘|body:何文田廣場 → 何文田體育館
```

### 4. Areas (zones / boundaries) — `area`

A GeoJSON `Polygon` rendered as a `fill` plus an outline `line`. The ring
auto-closes if you don't repeat the first point.

```text
area=pts:{lat},{lng};{lat},{lng}[;…]|color:{}|opacity:{}|outline:{}|title:{}|body:{}
```

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `pts` | `lat,lng` list | — | required; ring auto-closes |
| `color` | CSS color | `#2563eb` | fill |
| `opacity` | `0`–`1` | `0.2` | fill opacity |
| `outline` | CSS color | same as `color` | outline stroke |
| `title` `body` | text | — | click-popup content |

**A shaded estate boundary:**

```text
?area=pts:22.3120,114.1790;22.3120,114.1820;22.3100,114.1820;22.3100,114.1790|color:%232563eb|opacity:0.2|title:愛民邨範圍
```

### 5. Circles (radius rings) — `circle`

A center plus a radius in **meters**, approximated as a 64-sided polygon (styled
like an area).

```text
circle=lat:{}|lng:{}|radius:{m}|color:{}|opacity:{}|title:{}|body:{}
```

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `lat` `lng` | number | — | required, circle center |
| `radius` | meters | — | required, must be > 0 |
| `color` | CSS color | `#16a34a` | |
| `opacity` | `0`–`1` | `0.2` | |
| `title` `body` | text | — | click-popup content |

**A 500 m catchment around a car park:**

```text
?circle=lat:22.315203|lng:114.181846|radius:500|color:%2316a34a|opacity:0.15|title:5 分鐘步行圈
```

---

### Putting it together

One link with a marker, a route and a zone — auto-fitted to the viewport:

```text
?m=lat:22.315203|lng:114.181846|emoji:🏢|title:何文田停車場|body:空位 30
&line=pts:22.3152,114.1818;22.3131,114.1806|color:%23e11d48|width:4|title:步行 5 分鐘
&area=pts:22.3120,114.1790;22.3120,114.1820;22.3100,114.1820;22.3100,114.1790|color:%232563eb|opacity:0.2|title:愛民邨範圍
```

## ⚙️ How it works

`src/App.tsx` parses `window.location.search` into a `DrawableSet`
(`parseDrawables`), renders DOM `Marker`s + `Popup`s immediately, and adds GeoJSON
sources / layers on map `load` with per-feature data-driven styling. `circleRing`
(a haversine destination) turns radius meters into polygon rings. Cleanup removes
all markers, popups and layers on unmount — StrictMode-safe.

The URL grammar and every default live in **`src/maplink.schema.json`**, imported by
`src/App.tsx` via `src/schema.ts` so code and docs share one source of truth.

## 🤖 For AI agents

The deployed site serves machine-readable descriptions of the grammar, generated at
build time from that same schema:

| Resource | Path |
| --- | --- |
| Short index for LLMs | `/llms.txt` |
| Full API reference (this README) | `/llms-full.txt` |
| Machine-readable grammar | `/.well-known/maplink.schema.json` |

Point an agent at `llms.txt`: it lists every drawable, its required fields and the
encoding rules, then links to the schema for defaults. (`AGENTS.md` is different — it
is for agents *editing this repo*, not for agents *using the app*.)

These files are generated and git-ignored; regenerate with `npm run gen:agent`, which
also runs automatically before `npm run dev` and `npm run build`.

## 🧱 Stack

- **React 19** + **TypeScript** + **Vite 8**
- **`maplibre-gl` v6** — worker bundled via a `?url` import + `setWorkerUrl`
- **OpenFreeMap** vector tiles — no API key
- **Vercel** — static deploy; `vercel.json` rewrites app paths to `index.html`
  (excluding `/assets/*` and `/.well-known/*`, so missing files 404 properly)
