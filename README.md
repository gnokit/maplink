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
- **Real street routes.** `route=` resolves driving / walking / cycling routes at
  view time via [routing.openstreetmap.de](https://routing.openstreetmap.de/) — free, no key.
- **One file of logic.** The entire map lives in [`src/App.tsx`](src/App.tsx).
- **It scales.** Past 50 markers, DOM pins automatically upgrade to a GPU `circle` layer.

## 🚀 Run it

```sh
npm install
npm run dev      # http://localhost:5173/
npm run build    # type-check + production build
```

With no params at all, the map falls back to a built-in Victoria Harbour demo
that exercises the three core primitives with grouped categories in the panel —
two markers, a live driving route (one OSRM request at view time) and a 500 m
walking ring.

## 📖 URL API

### The ground rules

- **Repeatable** — each drawable param may appear many times; one object per occurrence.
- **Field syntax** — `key:value` pairs joined by `|`, in any order.
- **Required** — `lat` + `lng` for `m` / `popup` / `circle`; `pts` for `line` / `area`; `from` + `to` for `route`.
- **Forgiving** — unknown keys are ignored and malformed entries are skipped, never errored.
- **Limit** — 100 entries per type (`route`: 10, since each costs the visitor a routing request).
- **Escaping** — write a literal separator as `\|` or `\:`. Popup text is HTML-escaped.
- **Encoding** — non-ASCII just works; only `#` → `%23` and newline → `%0A` need hand-encoding.

### Short field names

Every drawable field has a one-letter alias, and hex colours may drop the `#`. Both
spellings are accepted; AI agents should prefer the short form.

| Long | Short | Long | Short |
| --- | --- | --- | --- |
| `lat` | `a` | `title` | `t` |
| `lng` | `o` | `body` | `b` |
| `label` | `l` | `group` | `g` |
| `emoji` | `e` | `subtitle` | `s` |
| `color` | `c` | `radius` | `r` |
| `scale` | `z` | `pts` | `p` |
| `anchor` | `k` | `width` | `w` |
| `offset` | `f` | `outline` | `u` |
| `rotation` | `q` | `opacity` | `y` |
| `drag` | `d` | `from` | `x` |
| | | `to` | `i` |
| | | `via` | `v` |
| | | `profile` | `h` |

```text
?m=a:22.315203|o:114.181846|l:30|e:🏢|c:2563eb|t:何文田停車場|g:停車場|b:空位 30
```

Top-level params (`m`, `popup`, `line`, `area`, `circle`, `route`, `title`, `panel`, `group`,
`center`, `zoom`, `style`) are unchanged.

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

### Panel

An optional left-hand **list of everything on the map** (markers, popups, lines,
areas, circles) so you can tell what's what and jump to it.

```text
title={panel heading}   panel={0|1}   group={initial chip}
```

| Param | Meaning | Default |
| --- | --- | --- |
| `title` | Panel heading | none |
| `panel` | Force the panel open (`1`) or closed (`0`) | open when any drawable has `title` or `group` |
| `group` | Category chip selected on load | 全部 (All) |

Every drawable also accepts two panel fields:

- `group` — category; chips are built from the distinct values (first-seen order) and selecting a chip filters **both the list and the map**.
- `subtitle` — second line in the list; defaults to the first line of `body`.

Clicking a row flies to the item and opens its popup; the ☰ button collapses the
panel. Below 640px the panel becomes a bottom sheet. Links whose drawables carry
no `title`/`group` stay chrome-free — no panel at all.

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

### 4. Street routes — `route`

A real path between two points, snapped to the street / footpath / cycle network.
Unlike every other drawable, `route` is **resolved at view time**: the link only
carries the endpoints, and each visitor's browser asks OSM's public OSRM routers
([routing.openstreetmap.de](https://routing.openstreetmap.de/), free, no key) for
the geometry. Endpoints are drawn as a straight line immediately and swap to the
resolved path — with distance & duration added to the popup and panel row — when
the response lands. If the request fails (offline, unroutable pair), the straight
line stays and a console warning explains why.

```text
route=from:{lat},{lng}|to:{lat},{lng}[|via:{lat},{lng};…]|profile:{drive|walk|bike}
     |color:{}|width:{}|opacity:{}|title:{}|body:{}|group:{}|subtitle:{}
```

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `from` `to` | `lat,lng` | — | required, route origin / destination |
| `via` | `lat,lng` list | — | `;`-separated intermediate stops, visited in order |
| `profile` | enum | `drive` | `drive` / `walk` / `bike` (also `car`, `foot`, `bicycle`) |
| `color` | CSS color | `#0284c7` | |
| `width` | number | `5` | line width in px |
| `opacity` | `0`–`1` | `1` | |
| `title` `body` | text | — | click-popup content; `📏 distance · ⏱ duration` is appended once resolved |

**Drive from the ferry pier to the estate, with a pit stop:**

```text
?route=from:22.2939,114.1694|via:22.3080,114.1740|to:22.3120,114.1790|profile:drive|title:駕車去愛民邨
```

> Max **10 routes** per link — each visitor pays one routing request, so don't
> link-bomb the router. No network → straight-line fallback.

### 5. Areas (zones / boundaries) — `area`

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

### 6. Circles (radius rings) — `circle`

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
&route=from:22.2939,114.1694|to:22.3120,114.1790|profile:drive|title:駕車去愛民邨
&area=pts:22.3120,114.1790;22.3120,114.1820;22.3100,114.1820;22.3100,114.1790|color:%232563eb|opacity:0.2|title:愛民邨範圍
```

## ⚙️ How it works

`src/App.tsx` parses `window.location.search` into a `DrawableSet`
(`parseDrawables`), renders DOM `Marker`s + `Popup`s immediately, and adds GeoJSON
sources / layers on map `load` with per-feature data-driven styling. `circleRing`
(a haversine destination) turns radius meters into polygon rings. `route` entries
enter the same GeoJSON source as straight endpoint lines and each spawns a fetch
to OSM's public OSRM routers; resolved geometry and `📏 · ⏱` metrics replace the
placeholder (autorefit follows), while failures keep the straight line. Cleanup
removes all markers, popups and layers on unmount and aborts in-flight route
fetches — StrictMode-safe.

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
