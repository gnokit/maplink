import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import './panel.css'
import {
  ANCHORS,
  DEFAULTS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  DOM_MARKER_LIMIT,
  FIELD_ALIAS,
  MAX_PER_TYPE,
  STYLES,
} from './schema'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

// ---------------------------------------------------------------------------
// URL drawable API (see README; src/maplink.schema.json is the doc source):
//   m=lat:{}|lng:{}|label:{}|emoji:{}|color:{}|scale:{}|anchor:{}|offset:{x},{y}
//     |rotation:{}|opacity:{}|drag:{0|1}|title:{}|body:{}|group:{}|subtitle:{}
//   popup=lat:{}|lng:{}|title:{}|body:{}|group:{}|subtitle:{}
//   line=pts:{lat},{lng};…|color:{}|width:{}|opacity:{}|title:{}|body:{}|group:{}|subtitle:{}
//   area=pts:{lat},{lng};…|color:{}|opacity:{}|outline:{}|title:{}|body:{}|group:{}|subtitle:{}
//   circle=lat:{}|lng:{}|radius:{m}|color:{}|opacity:{}|title:{}|body:{}|group:{}|subtitle:{}
//   route=from:{lat},{lng}|to:{lat},{lng}[|via:{lat},{lng};…]|profile:{drive|walk|bike}
//     |color:{}|width:{}|opacity:{}|title:{}|body:{}|group:{}|subtitle:{}
//     — resolved client-side against routing.openstreetmap.de (free, no key);
//       falls back to a straight line if the request fails.
//   json={URL-encoded GeoJSON} — raw passthrough (repeatable): Feature /
//     FeatureCollection / bare Geometry → one MapLibre geojson source with fixed
//     paint; no panel row, no group filtering, no popup.
//   center={lat}|{lng}  zoom={n}  style={bright|positron|liberty}
//   title={panel heading}  panel={0|1}  group={initial chip}
// Drawable fields also accept one-letter aliases (lat→a, lng→o, color→c, …) and
// hex colours may omit '#' (c:2563eb). See FIELD_ALIAS + README "Short field names".
// All drawable params are repeatable. Only listed keys are read, malformed
// entries are ignored, max 100 entries per type. `\|` / `\:` escape separators.
// ---------------------------------------------------------------------------

// Robustness caps for attacker-supplied URLs (self-DoS guard).
const MAX_VALUE_CHARS = 20000
const MAX_POINTS = 2000
const MAX_SCALE = 5
const MAX_RADIUS_M = 10_000_000
// Routes each cost a network request at view time, so cap them far below
// the generic MAX_PER_TYPE=100 self-DoS guard.
const MAX_ROUTES = 10
// `?json=` carries a whole GeoJSON document in one value — bound its size and
// its total coordinate count (feature count reuses MAX_PER_TYPE).
const MAX_JSON_CHARS = 200_000
const MAX_JSON_POINTS = 20_000

type DrawMarker = {
  lat: number
  lng: number
  label?: string
  emoji?: string
  color?: string
  scale?: number
  anchor?: maplibregl.MarkerOptions['anchor']
  offset?: [number, number]
  rotation?: number
  opacity?: number
  draggable?: boolean
  title?: string
  body?: string
  group?: string
  subtitle?: string
}

type DrawPopup = {
  lat: number
  lng: number
  title?: string
  body?: string
  group?: string
  subtitle?: string
}

type DrawLine = {
  pts: Array<[number, number]>
  color?: string
  width?: number
  opacity?: number
  title?: string
  body?: string
  group?: string
  subtitle?: string
}

type DrawArea = {
  pts: Array<[number, number]>
  color?: string
  opacity?: number
  outline?: string
  title?: string
  body?: string
  group?: string
  subtitle?: string
}

type DrawCircle = {
  lat: number
  lng: number
  radius: number
  color?: string
  opacity?: number
  title?: string
  body?: string
  group?: string
  subtitle?: string
}

type LatLng = { lat: number; lng: number }
type RouteProfile = 'drive' | 'walk' | 'bike'

// profile spelling → OSRM instance (routing.openstreetmap.de).
const ROUTE_PROFILES: Record<string, RouteProfile> = {
  drive: 'drive',
  car: 'drive',
  walk: 'walk',
  foot: 'walk',
  bike: 'bike',
  bicycle: 'bike',
}
const PROFILE_EMOJI: Record<RouteProfile, string> = {
  drive: '🚗',
  walk: '🚶',
  bike: '🚴',
}

type DrawRoute = {
  from: LatLng
  to: LatLng
  via: LatLng[]
  profile: RouteProfile
  color?: string
  width?: number
  opacity?: number
  title?: string
  body?: string
  group?: string
  subtitle?: string
}

type GJFeature = {
  type: 'Feature'
  geometry:
    | { type: 'LineString'; coordinates: Array<[number, number]> }
    | { type: 'Polygon'; coordinates: Array<Array<[number, number]>> }
  properties: Record<string, unknown>
}

// Raw GeoJSON passthrough (`?json=`). Geometry types MapLibre's `$type` filter
// understands; GeometryCollections are flattened into single-geometry features.
type JsonGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'MultiPoint'; coordinates: Array<[number, number]> }
  | { type: 'LineString'; coordinates: Array<[number, number]> }
  | { type: 'MultiLineString'; coordinates: Array<Array<[number, number]>> }
  | { type: 'Polygon'; coordinates: Array<Array<[number, number]>> }
  | { type: 'MultiPolygon'; coordinates: Array<Array<Array<[number, number]>>> }

type JsonFeature = {
  type: 'Feature'
  geometry: JsonGeometry
  properties: Record<string, unknown>
}

function splitEscaped(s: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length) {
      cur += s[i + 1]
      i++
    } else if (ch === sep) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function parseKV(item: string): Record<string, string> {
  const rec: Record<string, string> = {}
  for (const part of splitEscaped(item, '|')) {
    const idx = part.indexOf(':')
    if (idx <= 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1)
    rec[FIELD_ALIAS[key] ?? key] =
      value.length > MAX_VALUE_CHARS ? value.slice(0, MAX_VALUE_CHARS) : value
  }
  return rec
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// Accept bare hex (`color:2563eb`) as shorthand for `#2563eb`.
function cssColor(v: string | undefined): string | undefined {
  if (!v) return undefined
  return /^[0-9a-fA-F]{3,8}$/.test(v) ? `#${v}` : v
}

function latLng(
  latRaw: string | undefined,
  lngRaw: string | undefined,
): { lat: number; lng: number } | undefined {
  const lat = num(latRaw)
  const lng = num(lngRaw)
  if (lat === undefined || lng === undefined) return undefined
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined
  return { lat, lng }
}

function parsePts(s: string | undefined): Array<[number, number]> | undefined {
  if (!s) return undefined
  const pts: Array<[number, number]> = []
  for (const chunk of splitEscaped(s, ';')) {
    if (pts.length >= MAX_POINTS) break
    const [latRaw, lngRaw] = chunk.split(',')
    const ll = latLng(latRaw?.trim(), lngRaw?.trim())
    if (ll) pts.push([ll.lng, ll.lat])
  }
  return pts.length >= 2 ? pts : undefined
}

function parseMarker(item: string): DrawMarker | undefined {
  const kv = parseKV(item)
  const ll = latLng(kv.lat, kv.lng)
  if (!ll) return undefined
  const m: DrawMarker = { lat: ll.lat, lng: ll.lng }
  if (kv.label) m.label = kv.label
  if (kv.emoji) m.emoji = kv.emoji
  if (kv.color) m.color = cssColor(kv.color)
  const scale = num(kv.scale)
  if (scale !== undefined && scale > 0) m.scale = Math.min(scale, MAX_SCALE)
  if (kv.anchor && ANCHORS.has(kv.anchor)) {
    m.anchor = kv.anchor as DrawMarker['anchor']
  }
  if (kv.offset) {
    const [x, y] = kv.offset.split(',').map(Number)
    if (Number.isFinite(x) && Number.isFinite(y)) m.offset = [x, y]
  }
  const rotation = num(kv.rotation)
  if (rotation !== undefined) m.rotation = rotation
  const opacity = num(kv.opacity)
  if (opacity !== undefined && opacity >= 0 && opacity <= 1) m.opacity = opacity
  if (kv.drag === '1' || kv.drag === 'true') m.draggable = true
  if (kv.title) m.title = kv.title
  if (kv.body) m.body = kv.body
  if (kv.group) m.group = kv.group
  if (kv.subtitle) m.subtitle = kv.subtitle
  return m
}

function parsePopup(item: string): DrawPopup | undefined {
  const kv = parseKV(item)
  const ll = latLng(kv.lat, kv.lng)
  if (!ll) return undefined
  const p: DrawPopup = { lat: ll.lat, lng: ll.lng }
  if (kv.title) p.title = kv.title
  if (kv.body) p.body = kv.body
  if (kv.group) p.group = kv.group
  if (kv.subtitle) p.subtitle = kv.subtitle
  return p
}

function parseLine(item: string): DrawLine | undefined {
  const kv = parseKV(item)
  const pts = parsePts(kv.pts)
  if (!pts) return undefined
  const line: DrawLine = { pts }
  if (kv.color) line.color = cssColor(kv.color)
  const width = num(kv.width)
  if (width !== undefined && width > 0) line.width = width
  const opacity = num(kv.opacity)
  if (opacity !== undefined && opacity >= 0 && opacity <= 1) line.opacity = opacity
  if (kv.title) line.title = kv.title
  if (kv.body) line.body = kv.body
  if (kv.group) line.group = kv.group
  if (kv.subtitle) line.subtitle = kv.subtitle
  return line
}

function parseArea(item: string): DrawArea | undefined {
  const kv = parseKV(item)
  const pts = parsePts(kv.pts)
  if (!pts) return undefined
  // Close the ring if the URL didn't.
  const ring = pts.slice()
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push([ring[0][0], ring[0][1]])
  }
  const area: DrawArea = { pts: ring }
  if (kv.color) area.color = cssColor(kv.color)
  const opacity = num(kv.opacity)
  if (opacity !== undefined && opacity >= 0 && opacity <= 1) area.opacity = opacity
  if (kv.outline) area.outline = cssColor(kv.outline)
  if (kv.title) area.title = kv.title
  if (kv.body) area.body = kv.body
  if (kv.group) area.group = kv.group
  if (kv.subtitle) area.subtitle = kv.subtitle
  return area
}

function parseCircle(item: string): DrawCircle | undefined {
  const kv = parseKV(item)
  const ll = latLng(kv.lat, kv.lng)
  const radius = num(kv.radius)
  if (!ll || radius === undefined || radius <= 0) return undefined
  const circle: DrawCircle = { lat: ll.lat, lng: ll.lng, radius: Math.min(radius, MAX_RADIUS_M) }
  if (kv.color) circle.color = cssColor(kv.color)
  const opacity = num(kv.opacity)
  if (opacity !== undefined && opacity >= 0 && opacity <= 1) circle.opacity = opacity
  if (kv.title) circle.title = kv.title
  if (kv.body) circle.body = kv.body
  if (kv.group) circle.group = kv.group
  if (kv.subtitle) circle.subtitle = kv.subtitle
  return circle
}

// `lat,lng` with optional surrounding whitespace (e.g. `from:22.3152,114.1818`).
function parseLatLngPair(s: string | undefined): LatLng | undefined {
  if (!s) return undefined
  const [latRaw, lngRaw] = s.split(',')
  return latLng(latRaw?.trim(), lngRaw?.trim())
}

function parseRoute(item: string): DrawRoute | undefined {
  const kv = parseKV(item)
  const from = parseLatLngPair(kv.from)
  const to = parseLatLngPair(kv.to)
  if (!from || !to) return undefined
  const profile = ROUTE_PROFILES[(kv.profile ?? '').toLowerCase()] ?? 'drive'
  const via: LatLng[] = []
  if (kv.via) {
    for (const chunk of splitEscaped(kv.via, ';')) {
      if (via.length >= MAX_POINTS) break
      const ll = parseLatLngPair(chunk)
      if (ll) via.push(ll)
    }
  }
  const r: DrawRoute = { from, to, via, profile }
  if (kv.color) r.color = cssColor(kv.color)
  const width = num(kv.width)
  if (width !== undefined && width > 0) r.width = width
  const opacity = num(kv.opacity)
  if (opacity !== undefined && opacity >= 0 && opacity <= 1) r.opacity = opacity
  if (kv.title) r.title = kv.title
  if (kv.body) r.body = kv.body
  if (kv.group) r.group = kv.group
  if (kv.subtitle) r.subtitle = kv.subtitle
  return r
}

// ---------------------------------------------------------------------------
// Raw GeoJSON passthrough (`?json=`) — an addition, not part of the drawable
// grammar. The document is translated straight into a MapLibre geojson source
// and drawn with fixed paint: no panel row, no group filtering, no popup. The
// value must be fully percent-encoded on the wire; malformed input is skipped.
// ---------------------------------------------------------------------------

type CoordBudget = { n: number }

// A single [lng, lat] position, range-checked and charged to the shared budget.
function normPosition(raw: unknown, budget: CoordBudget): [number, number] | undefined {
  if (budget.n >= MAX_JSON_POINTS) return undefined
  if (!Array.isArray(raw) || raw.length < 2) return undefined
  const lng = Number(raw[0])
  const lat = Number(raw[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return undefined
  budget.n++
  return [lng, lat]
}

function normPositions(
  raw: unknown,
  budget: CoordBudget,
  min: number,
): Array<[number, number]> | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Array<[number, number]> = []
  for (const c of raw) {
    const p = normPosition(c, budget)
    if (!p) return undefined
    out.push(p)
  }
  return out.length >= min ? out : undefined
}

// Close a polygon ring if the URL didn't repeat the first point.
function normRing(raw: unknown, budget: CoordBudget): Array<[number, number]> | undefined {
  const ring = normPositions(raw, budget, 3)
  if (!ring) return undefined
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]])
  return ring
}

function normRings(
  raw: unknown,
  budget: CoordBudget,
): Array<Array<[number, number]>> | undefined {
  if (!Array.isArray(raw)) return undefined
  const rings: Array<Array<[number, number]>> = []
  for (const ring of raw) {
    const r = normRing(ring, budget)
    if (!r) return undefined
    rings.push(r)
  }
  return rings.length > 0 ? rings : undefined
}

function normGeometry(raw: unknown, budget: CoordBudget): JsonGeometry | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const g = raw as { type?: unknown; coordinates?: unknown }
  switch (g.type) {
    case 'Point': {
      const c = normPosition(g.coordinates, budget)
      return c ? { type: 'Point', coordinates: c } : undefined
    }
    case 'MultiPoint': {
      const c = normPositions(g.coordinates, budget, 1)
      return c ? { type: 'MultiPoint', coordinates: c } : undefined
    }
    case 'LineString': {
      const c = normPositions(g.coordinates, budget, 2)
      return c ? { type: 'LineString', coordinates: c } : undefined
    }
    case 'MultiLineString': {
      if (!Array.isArray(g.coordinates)) return undefined
      const lines: Array<Array<[number, number]>> = []
      for (const line of g.coordinates) {
        const l = normPositions(line, budget, 2)
        if (!l) return undefined
        lines.push(l)
      }
      return lines.length > 0 ? { type: 'MultiLineString', coordinates: lines } : undefined
    }
    case 'Polygon': {
      const rings = normRings(g.coordinates, budget)
      return rings ? { type: 'Polygon', coordinates: rings } : undefined
    }
    case 'MultiPolygon': {
      if (!Array.isArray(g.coordinates)) return undefined
      const polys: Array<Array<Array<[number, number]>>> = []
      for (const poly of g.coordinates) {
        const rings = normRings(poly, budget)
        if (!rings) return undefined
        polys.push(rings)
      }
      return polys.length > 0 ? { type: 'MultiPolygon', coordinates: polys } : undefined
    }
    default:
      return undefined
  }
}

// Walk a parsed document, flattening FeatureCollections + GeometryCollections
// into single-geometry features. `depth` guards pathological nesting.
function collectFeatures(
  raw: unknown,
  budget: CoordBudget,
  out: JsonFeature[],
  depth: number,
): void {
  if (!raw || typeof raw !== 'object' || out.length >= MAX_PER_TYPE || depth > 4) return
  const node = raw as {
    type?: unknown
    geometry?: { type?: unknown; geometries?: unknown }
    coordinates?: unknown
    properties?: unknown
    features?: unknown
    geometries?: unknown
  }
  if (node.type === 'FeatureCollection') {
    if (Array.isArray(node.features)) {
      for (const f of node.features) collectFeatures(f, budget, out, depth + 1)
    }
    return
  }
  if (node.type === 'Feature') {
    const props =
      node.properties && typeof node.properties === 'object'
        ? (node.properties as Record<string, unknown>)
        : {}
    if (node.geometry?.type === 'GeometryCollection') {
      if (Array.isArray(node.geometry.geometries)) {
        for (const g of node.geometry.geometries) {
          collectFeatures({ type: 'Feature', geometry: g, properties: props }, budget, out, depth + 1)
        }
      }
      return
    }
    const geom = normGeometry(node.geometry, budget)
    if (geom) out.push({ type: 'Feature', geometry: geom, properties: props })
    return
  }
  if (node.type === 'GeometryCollection') {
    if (Array.isArray(node.geometries)) {
      for (const g of node.geometries) {
        collectFeatures({ type: 'Feature', geometry: g, properties: {} }, budget, out, depth + 1)
      }
    }
    return
  }
  // Bare geometry.
  const geom = normGeometry(node, budget)
  if (geom) out.push({ type: 'Feature', geometry: geom, properties: {} })
}

// `?json=` is repeatable; multiple documents merge under one coordinate budget.
function parseJson(raws: string[]): JsonFeature[] {
  const out: JsonFeature[] = []
  const budget: CoordBudget = { n: 0 }
  for (const raw of raws) {
    if (!raw) continue
    if (raw.length > MAX_JSON_CHARS) {
      console.warn(`maplink: json= exceeds ${MAX_JSON_CHARS} chars — skipped`)
      continue
    }
    let doc: unknown
    try {
      doc = JSON.parse(raw)
    } catch {
      console.warn('maplink: json= is not valid JSON — skipped')
      continue
    }
    collectFeatures(doc, budget, out, 0)
    if (out.length >= MAX_PER_TYPE) break
  }
  return out
}

// Visit every [lng, lat] position in a parsed geometry (for bounding box calc).
function eachCoord(geom: JsonGeometry, cb: (lng: number, lat: number) => void): void {
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      cb(node[0], node[1])
      return
    }
    for (const child of node) walk(child)
  }
  walk(geom.coordinates)
}

type DrawableSet = {
  markers: DrawMarker[]
  popups: DrawPopup[]
  lines: DrawLine[]
  areas: DrawArea[]
  circles: DrawCircle[]
  routes: DrawRoute[]
  json: JsonFeature[]
  center?: [number, number]
  zoom?: number
  style: string
  panelTitle?: string
  hasPanel: boolean
  panelOpen: boolean
  initialGroup?: string
}

// Demo content shown when the URL carries no drawables. It exercises the three
// core primitives — grouped markers, a live street route and a radius ring —
// with one group each so the panel's chip filtering is demonstrated too. The
// route costs one OSRM request at view time; offline it stays a straight line.
const DEMO: {
  markers: DrawMarker[]
  popups: DrawPopup[]
  lines: DrawLine[]
  areas: DrawArea[]
  circles: DrawCircle[]
  routes: DrawRoute[]
  panelTitle: string
} = {
  panelTitle: '維港地圖 · 示範',
  popups: [],
  lines: [],
  areas: [],
  markers: [
    {
      lat: 22.2939,
      lng: 114.1694,
      emoji: '🚢',
      color: '#2563eb',
      group: '交通',
      title: '天星小輪碼頭',
      body: '尖沙咀 ⇄ 中環 · 港內渡輪\n示範：地圖標記（emoji + 分組）',
    },
    {
      lat: 22.2978,
      lng: 114.172,
      emoji: '🍜',
      color: '#ea580c',
      group: '美食',
      title: '一蘭拉麵（尖沙咀）',
      body: '示範：地圖標記',
    },
  ],
  routes: [
    {
      from: { lat: 22.2939, lng: 114.1694 },
      via: [{ lat: 22.295, lng: 114.1728 }],
      to: { lat: 22.2978, lng: 114.172 },
      profile: 'drive',
      group: '路線',
      title: '駕車示範路線',
      body: '天星碼頭 → 星光大道 → 一蘭拉麵\n示範：真實街道路徑',
    },
  ],
  circles: [
    {
      lat: 22.2939,
      lng: 114.1694,
      radius: 500,
      color: '#16a34a',
      opacity: 0.15,
      group: '範圍',
      title: '5 分鐘步行圈',
      body: '以天星碼頭為圓心 · 半徑 500 米\n示範：半徑範圍圈',
    },
  ],
}

function parseDrawables(search: string): DrawableSet {
  const params = new URLSearchParams(search)
  const take = <T,>(keys: string[], fn: (s: string) => T | undefined): T[] => {
    const out: T[] = []
    for (const k of keys) {
      for (const raw of params.getAll(k)) {
        const v = fn(raw)
        if (v !== undefined) {
          out.push(v)
          if (out.length >= MAX_PER_TYPE) return out
        }
      }
    }
    return out
  }

  const markers = take(['m', 'pin', 'marker'], parseMarker)
  const popups = take(['popup'], parsePopup)
  const lines = take(['line'], parseLine)
  const areas = take(['area'], parseArea)
  const circles = take(['circle'], parseCircle)
  // Each route costs a network request, so the take() cap is applied twice.
  const routes = take(['route'], parseRoute).slice(0, MAX_ROUTES)
  // Raw GeoJSON passthrough — independent of the drawable grammar/panel.
  const json = parseJson(params.getAll('json'))

  let center: [number, number] | undefined
  const centerRaw = params.get('center')
  if (centerRaw) {
    const [latRaw, lngRaw] = splitEscaped(centerRaw, '|')
    const ll = latLng(latRaw?.trim(), lngRaw?.trim())
    if (ll) center = [ll.lng, ll.lat]
  }
  const zoomRaw = num(params.get('zoom') ?? undefined)
  const zoom = zoomRaw !== undefined && zoomRaw >= 0 && zoomRaw <= 22 ? zoomRaw : undefined

  const styleKey = (params.get('style') ?? '').toLowerCase()
  const style = STYLES[styleKey] ?? STYLES.bright

  const hasUrlDrawables =
    markers.length > 0 ||
    popups.length > 0 ||
    lines.length > 0 ||
    areas.length > 0 ||
    circles.length > 0 ||
    routes.length > 0 ||
    json.length > 0

  const drawables = hasUrlDrawables
    ? { markers, popups, lines, areas, circles, routes }
    : DEMO

  const allDrawables: Array<{ title?: string; group?: string }> = [
    ...drawables.markers,
    ...drawables.popups,
    ...drawables.lines,
    ...drawables.areas,
    ...drawables.circles,
    ...drawables.routes,
  ]
  const hasTitles = allDrawables.some((d) => d.title || d.group)

  const panelParam = params.get('panel')
  const panelTitle = hasUrlDrawables ? params.get('title') || undefined : DEMO.panelTitle
  const initialGroup = params.get('group') || undefined
  const hasPanel = hasTitles || panelParam === '1'
  const panelOpen = panelParam === '1' ? true : panelParam === '0' ? false : hasTitles

  return {
    markers: drawables.markers,
    popups: drawables.popups,
    lines: drawables.lines,
    areas: drawables.areas,
    circles: drawables.circles,
    routes: drawables.routes,
    json,
    center,
    zoom,
    style,
    panelTitle,
    hasPanel,
    panelOpen,
    initialGroup,
  }
}

// Approximate a circle (radius in meters) as a GeoJSON polygon ring.
function circleRing(lng: number, lat: number, radiusM: number, steps = 64): Array<[number, number]> {
  const R = 6371000
  const ring: Array<[number, number]> = []
  const latR = (lat * Math.PI) / 180
  const lngR = (lng * Math.PI) / 180
  for (let i = 0; i < steps; i++) {
    const brng = (i / steps) * 2 * Math.PI
    const lat2 = Math.asin(
      Math.sin(latR) * Math.cos(radiusM / R) +
        Math.cos(latR) * Math.sin(radiusM / R) * Math.cos(brng),
    )
    const lng2 =
      lngR +
      Math.atan2(
        Math.sin(brng) * Math.sin(radiusM / R) * Math.cos(latR),
        Math.cos(radiusM / R) - Math.sin(latR) * Math.sin(lat2),
      )
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }
  ring.push(ring[0])
  return ring
}

// OSRM instance + endpoint profile for a parsed route, against OSM's public
// routers: free, no key. Per-request path segment matches the loaded profile.
function routeUrl(r: DrawRoute): string {
  const [instance, path] =
    r.profile === 'walk'
      ? ['routed-foot', 'foot']
      : r.profile === 'bike'
        ? ['routed-bike', 'bike']
        : ['routed-car', 'driving']
  const coords = [r.from, ...r.via, r.to]
    .slice(0, MAX_POINTS)
    .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
    .join(';')
  return `https://routing.openstreetmap.de/${instance}/route/v1/${path}/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`
}

function fmtDistance(m: number): string {
  if (m >= 1000) return m >= 10000 ? `${Math.round(m / 1000)} 公里` : `${(m / 1000).toFixed(1)} 公里`
  return `${Math.round(m)} 米`
}

function fmtDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60))
  if (min < 60) return `${min} 分鐘`
  return `${Math.floor(min / 60)} 小時 ${min % 60} 分鐘`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function popupHtml(title?: string, body?: string, icon?: string): string {
  const t = title ? `<strong>${icon ? `${escapeHtml(icon)} ` : ''}${escapeHtml(title)}</strong>` : ''
  const b = body ? escapeHtml(body).replace(/\n/g, '<br>') : ''
  return `<div style="font-size:13px;line-height:1.5;min-width:180px;max-width:260px">${t}${t && b ? '<br>' : ''}${b}</div>`
}

function markerElement(m: DrawMarker, fallbackText: string): HTMLDivElement {
  const el = document.createElement('div')
  el.textContent = m.label ?? m.emoji ?? fallbackText
  if (m.title) el.title = m.title
  const s = m.scale ?? 1
  const size = Math.round(28 * s)
  el.style.cssText =
    `width:${size}px;height:${size}px;border-radius:50%;color:#fff;` +
    `font:700 ${Math.round(14 * s)}px/${size}px system-ui,sans-serif;text-align:center;cursor:pointer;` +
    `border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5);`
  // Assigned as a property (never interpolated into cssText) so a crafted colour
  // can't inject extra declarations; an invalid value is simply ignored.
  el.style.background = m.color ?? DEFAULTS.marker.color
  return el
}

function featurePopupHtml(f: maplibregl.MapGeoJSONFeature): string | undefined {
  const title = typeof f.properties.title === 'string' ? f.properties.title : undefined
  const body = typeof f.properties.body === 'string' ? f.properties.body : undefined
  if (!title && !body) return undefined
  return popupHtml(title, body)
}

// ---------------------------------------------------------------------------
// Overlay panel (Google-Maps-style list of the URL's drawables).
// ---------------------------------------------------------------------------

type PanelItem = {
  key: string
  title: string
  subtitle?: string
  color: string
  emoji?: string
  trailing?: string
  group?: string
  lng: number
  lat: number
  html?: string
}

type Groupable = { element: HTMLElement; group?: string }
type MapFilter = Parameters<maplibregl.Map['setFilter']>[1]

function firstLine(body: string | undefined): string | undefined {
  if (!body) return undefined
  const line = body.split('\n')[0].trim()
  return line || undefined
}

function midpoint(pts: Array<[number, number]>): [number, number] {
  return pts[Math.floor((pts.length - 1) / 2)]
}

function centroid(pts: Array<[number, number]>): [number, number] {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p[0]
    y += p[1]
  }
  return [x / pts.length, y / pts.length]
}

function buildItems(draw: DrawableSet): PanelItem[] {
  const items: PanelItem[] = []

  draw.markers.forEach((m, i) => {
    items.push({
      key: `m-${i}`,
      title: m.title || m.label || m.emoji || `標記 ${i + 1}`,
      subtitle: m.subtitle ?? firstLine(m.body),
      color: m.color ?? DEFAULTS.marker.color,
      emoji: m.emoji,
      trailing: m.label,
      group: m.group,
      lng: m.lng,
      lat: m.lat,
      html: m.title || m.body ? popupHtml(m.title, m.body, m.emoji) : undefined,
    })
  })

  draw.popups.forEach((p, i) => {
    items.push({
      key: `p-${i}`,
      title: p.title || `地點 ${i + 1}`,
      subtitle: p.subtitle ?? firstLine(p.body),
      color: '#6b7280',
      group: p.group,
      lng: p.lng,
      lat: p.lat,
      html: popupHtml(p.title, p.body),
    })
  })

  draw.lines.forEach((l, i) => {
    const [lng, lat] = midpoint(l.pts)
    items.push({
      key: `l-${i}`,
      title: l.title || `路線 ${i + 1}`,
      subtitle: l.subtitle ?? firstLine(l.body),
      color: l.color ?? DEFAULTS.line.color,
      group: l.group,
      lng,
      lat,
      html: l.title || l.body ? popupHtml(l.title, l.body) : undefined,
    })
  })

  draw.areas.forEach((a, i) => {
    const [lng, lat] = centroid(a.pts)
    items.push({
      key: `a-${i}`,
      title: a.title || `區域 ${i + 1}`,
      subtitle: a.subtitle ?? firstLine(a.body),
      color: a.color ?? DEFAULTS.area.color,
      group: a.group,
      lng,
      lat,
      html: a.title || a.body ? popupHtml(a.title, a.body) : undefined,
    })
  })

  draw.circles.forEach((c, i) => {
    items.push({
      key: `c-${i}`,
      title: c.title || `範圍 ${i + 1}`,
      subtitle: c.subtitle ?? firstLine(c.body),
      color: c.color ?? DEFAULTS.circle.color,
      group: c.group,
      lng: c.lng,
      lat: c.lat,
      html: c.title || c.body ? popupHtml(c.title, c.body) : undefined,
    })
  })

  draw.routes.forEach((r, i) => {
    items.push({
      key: `r-${i}`,
      title: r.title || `${PROFILE_LABEL[r.profile]}路線 ${i + 1}`,
      subtitle: r.subtitle ?? firstLine(r.body),
      color: r.color ?? DEFAULTS.route.color,
      emoji: PROFILE_EMOJI[r.profile],
      group: r.group,
      lng: (r.from.lng + r.to.lng) / 2,
      lat: (r.from.lat + r.to.lat) / 2,
      html: popupHtml(r.title, r.body, PROFILE_EMOJI[r.profile]),
    })
  })

  return items
}

const PROFILE_LABEL: Record<RouteProfile, string> = {
  drive: '駕車',
  walk: '步行',
  bike: '單車',
}

function buildPanel(opts: {
  map: maplibregl.Map
  items: PanelItem[]
  title?: string
  groups: string[]
  initialGroup?: string
  markerEls: Groupable[]
  popupEls: Groupable[]
  open: boolean
}): { root: HTMLElement; applyGroup: (g: string | null) => void; setRowSubtitle: (key: string, text: string) => void; destroy: () => void } {
  const { map } = opts

  const root = document.createElement('div')
  root.className = 'maplink-panel-root'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'maplink-toggle'
  toggle.textContent = '☰'
  toggle.setAttribute('aria-label', '顯示清單')
  toggle.setAttribute('aria-expanded', 'false')

  const panel = document.createElement('aside')
  panel.className = 'maplink-panel'
  panel.dataset.open = String(opts.open)

  const head = document.createElement('div')
  head.className = 'maplink-panel__head'
  const heading = document.createElement('h2')
  heading.className = 'maplink-panel__title'
  heading.textContent = opts.title ?? ''
  if (!opts.title) heading.hidden = true
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'maplink-panel__close'
  closeBtn.textContent = '☰'
  closeBtn.setAttribute('aria-label', '收起清單')
  head.append(heading, closeBtn)
  panel.appendChild(head)

  const chipValues: Array<string | null> = [null, ...opts.groups]
  const chipButtons: HTMLButtonElement[] = []
  if (opts.groups.length > 0) {
    const chipsWrap = document.createElement('div')
    chipsWrap.className = 'maplink-panel__chips'
    for (const gv of chipValues) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'maplink-chip'
      b.textContent = gv ?? '全部'
      b.setAttribute('aria-pressed', 'false')
      b.addEventListener('click', () => setGroup(gv))
      chipButtons.push(b)
      chipsWrap.appendChild(b)
    }
    panel.appendChild(chipsWrap)
  }

  const list = document.createElement('ul')
  list.className = 'maplink-panel__list'
  const rows: Array<{ li: HTMLLIElement; item: PanelItem }> = []
  for (const it of opts.items) {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'maplink-row'
    const lead = document.createElement('span')
    if (it.emoji) {
      lead.className = 'maplink-row__emoji'
      lead.textContent = it.emoji
    } else {
      lead.className = 'maplink-row__dot'
      lead.style.background = it.color
    }
    const text = document.createElement('span')
    text.className = 'maplink-row__text'
    const ttl = document.createElement('span')
    ttl.className = 'maplink-row__title'
    ttl.textContent = it.title
    text.appendChild(ttl)
    if (it.subtitle) {
      const sub = document.createElement('span')
      sub.className = 'maplink-row__sub'
      sub.textContent = it.subtitle
      text.appendChild(sub)
    }
    btn.append(lead, text)
    if (it.trailing) {
      const trail = document.createElement('span')
      trail.className = 'maplink-row__trail'
      trail.textContent = it.trailing
      btn.appendChild(trail)
    }
    btn.addEventListener('click', () => focusItem(it, btn))
    btn.dataset.maplinkKey = it.key
    li.appendChild(btn)
    list.appendChild(li)
    rows.push({ li, item: it })
  }
  panel.appendChild(list)

  if (opts.groups.length > 0) {
    const legend = document.createElement('div')
    legend.className = 'maplink-panel__legend'
    for (const g of opts.groups) {
      const source = opts.items.find((i) => i.group === g)
      const wrap = document.createElement('span')
      wrap.className = 'maplink-legend__item'
      const dot = document.createElement('span')
      dot.className = 'maplink-legend__dot'
      dot.style.background = source?.color ?? '#6b7280'
      const label = document.createElement('span')
      label.textContent = g
      wrap.append(dot, label)
      legend.appendChild(wrap)
    }
    panel.appendChild(legend)
  }

  root.append(toggle, panel)

  let focusPopup: maplibregl.Popup | null = null
  let activeBtn: HTMLButtonElement | null = null

  function clearActive() {
    if (activeBtn) {
      activeBtn.removeAttribute('aria-current')
      activeBtn = null
    }
    for (const m of opts.markerEls) m.element.style.outline = ''
  }

  function focusItem(it: PanelItem, btn: HTMLButtonElement) {
    if (focusPopup) {
      focusPopup.remove()
      focusPopup = null
    }
    clearActive()
    if (it.html) {
      focusPopup = new maplibregl.Popup({ offset: 24 })
        .setLngLat([it.lng, it.lat])
        .setHTML(it.html)
        .addTo(map)
    }
    map.flyTo({ center: [it.lng, it.lat], zoom: Math.max(map.getZoom(), 15), duration: 600 })
    btn.setAttribute('aria-current', 'true')
    activeBtn = btn
    const marker = opts.markerEls.find((m) => m.element.dataset.maplinkKey === it.key)
    if (marker) marker.element.style.outline = '3px solid #111827'
  }

  function applyGroup(g: string | null) {
    for (const r of rows) r.li.hidden = !(g === null || r.item.group === g)
    for (const m of opts.markerEls) m.element.style.display = g === null || m.group === g ? '' : 'none'
    for (const p of opts.popupEls) p.element.style.display = g === null || p.group === g ? '' : 'none'
    const withGroup = (base: MapFilter): MapFilter => {
      if (g === null) return base
      const byGroup = ['==', ['get', 'group'], g]
      return (base ? ['all', base, byGroup] : byGroup) as unknown as MapFilter
    }
    if (map.getLayer('maplink-area')) map.setFilter('maplink-area', withGroup(['==', '$type', 'Polygon']))
    if (map.getLayer('maplink-area-outline'))
      map.setFilter('maplink-area-outline', withGroup(['==', '$type', 'Polygon']))
    if (map.getLayer('maplink-line'))
      map.setFilter('maplink-line', withGroup(['==', '$type', 'LineString']))
    if (map.getLayer('maplink-points'))
      map.setFilter('maplink-points', g === null ? null : (['==', ['get', 'group'], g] as unknown as MapFilter))
  }

  function setGroup(g: string | null) {
    chipButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(chipValues[i] === g)))
    applyGroup(g)
  }

  function setOpen(open: boolean) {
    panel.dataset.open = String(open)
    toggle.hidden = open
    toggle.setAttribute('aria-expanded', String(open))
  }

  toggle.addEventListener('click', () => setOpen(true))
  closeBtn.addEventListener('click', () => setOpen(false))
  setOpen(opts.open)
  setGroup(opts.initialGroup ?? null)

  return {
    root,
    applyGroup,
    // Routes resolve their distance/duration after the panel exists; patch the
    // matching row's subtitle (and title span, if the row had none).
    setRowSubtitle(key, text) {
      const btn = root.querySelector<HTMLButtonElement>(`.maplink-row[data-maplink-key="${CSS.escape(key)}"]`)
      if (!btn) return
      let sub = btn.querySelector('.maplink-row__sub')
      if (!sub) {
        const textEl = btn.querySelector('.maplink-row__text')
        if (!textEl) return
        sub = document.createElement('span')
        sub.className = 'maplink-row__sub'
        textEl.appendChild(sub)
      }
      sub.textContent = text
    },
    destroy() {
      if (focusPopup) focusPopup.remove()
      root.remove()
    },
  }
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const overlay = overlayRef.current
    if (!container || !overlay) return
    const draw = parseDrawables(window.location.search)

    const map = new maplibregl.Map({
      container,
      style: draw.style,
      center: draw.center ?? DEFAULT_CENTER,
      zoom: draw.zoom ?? DEFAULT_ZOOM,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // Markers + standalone popups don't depend on the style — add immediately.
    const usePointsLayer = draw.markers.length > DOM_MARKER_LIMIT
    const markers: maplibregl.Marker[] = []
    const markerEls: Groupable[] = []
    if (!usePointsLayer) {
      draw.markers.forEach((m, i) => {
        const element = markerElement(m, String(i + 1))
        element.dataset.maplinkKey = `m-${i}`
        const marker = new maplibregl.Marker({
          element,
          anchor: m.anchor,
          offset: m.offset,
          rotation: m.rotation,
          draggable: m.draggable,
        })
          .setLngLat([m.lng, m.lat])
          .addTo(map)
        if (m.title || m.body) {
          marker.setPopup(
            new maplibregl.Popup({ offset: 24 }).setHTML(popupHtml(m.title, m.body, m.emoji)),
          )
        }
        if (m.opacity !== undefined) {
          element.style.opacity = String(m.opacity)
        }
        markers.push(marker)
        markerEls.push({ element, group: m.group })
      })
    }

    const popups: maplibregl.Popup[] = []
    const popupEls: Groupable[] = []
    for (const p of draw.popups) {
      if (!p.title && !p.body) continue
      const popup = new maplibregl.Popup({ offset: 24 })
        .setLngLat([p.lng, p.lat])
        .setHTML(popupHtml(p.title, p.body))
        .addTo(map)
      popups.push(popup)
      popupEls.push({ element: popup.getElement(), group: p.group })
    }

    const items = buildItems(draw)
    const groups = [
      ...new Set(items.map((i) => i.group).filter((g): g is string => Boolean(g))),
    ]
    const initialGroup =
      draw.initialGroup && groups.includes(draw.initialGroup) ? draw.initialGroup : undefined
    const panel =
      draw.hasPanel && items.length > 0
        ? buildPanel({
            map,
            items,
            title: draw.panelTitle,
            groups,
            initialGroup,
            markerEls,
            popupEls,
            open: draw.panelOpen,
          })
        : null
    if (panel) overlay.appendChild(panel.root)
    const panelPaddingLeft = panel && draw.panelOpen ? 340 : 80

    // Route resolution happens off the main URL parse: the shared GeoJSON
    // source holds straight endpoint lines until each OSRM response lands.
    // StrictMode double-mount gets one request set per mount; cleanup aborts.
    const controllers: AbortController[] = []
    // Assigned inside map.on('load'); resolveRoutes (declared in this scope)
    // touches them once the responses land.
    let routeGeom: Array<{ group?: string; pts: Array<[number, number]> }> = []
    let autoFit = () => {}

    function resolveRoutes(routes: DrawRoute[], featureIdx: number[], featureList: GJFeature[]) {
      function applyFeatures() {
        map.getSource<maplibregl.GeoJSONSource>('maplink-draw')?.setData({
          type: 'FeatureCollection',
          features: featureList,
        } as never)
      }
      let anyResolved = false
      const jobs = routes.map((r, i) => {
        const ctrl = new AbortController()
        controllers.push(ctrl)
        return fetch(routeUrl(r), { signal: ctrl.signal })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`route API ${res.status}`))))
          .then(
            (
              json: {
                routes?: Array<{
                  distance: number
                  duration: number
                  geometry?: { coordinates?: Array<[number, number]> }
                }>
              },
            ) => {
              const route = json.routes?.[0]
              const coords = route?.geometry?.coordinates
              if (!route || !coords || coords.length < 2) throw new Error('no route geometry')
              const f = featureList[featureIdx[i]]
              f.geometry = { type: 'LineString', coordinates: coords }
              const metrics = `📏 ${fmtDistance(route.distance)} · ⏱ ${fmtDuration(route.duration)}`
              f.properties.body = r.body ? `${r.body}\n${metrics}` : metrics
              routeGeom[i] = { group: r.group, pts: coords }
              if (!r.subtitle && !r.body) panel?.setRowSubtitle(`r-${i}`, metrics)
              anyResolved = true
              applyFeatures()
            },
          )
          .catch((err: unknown) => {
            if ((err as Error)?.name === 'AbortError') return
            console.warn(
              `maplink: route ${i + 1} could not be resolved — leaving the straight line fallback`,
              err,
            )
          })
      })
      // Auto-refit once all responses are in, so the fit includes street bends.
      Promise.allSettled(jobs).then(() => {
        if (anyResolved) autoFit()
      })
    }

    map.on('load', () => {
      // Lines + areas (+ radius circles as polygons) share one GeoJSON source,
      // with layers filtered by geometry type and styled per-feature.
      const features: GJFeature[] = []
      for (const l of draw.lines) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: l.pts },
          properties: {
            color: l.color ?? DEFAULTS.line.color,
            width: l.width ?? DEFAULTS.line.width,
            opacity: l.opacity ?? DEFAULTS.line.opacity,
            title: l.title ?? null,
            body: l.body ?? null,
            group: l.group ?? null,
          },
        })
      }
      for (const a of draw.areas) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [a.pts] },
          properties: {
            color: a.color ?? DEFAULTS.area.color,
            opacity: a.opacity ?? DEFAULTS.area.opacity,
            outline: a.outline ?? a.color ?? DEFAULTS.area.color,
            title: a.title ?? null,
            body: a.body ?? null,
            group: a.group ?? null,
          },
        })
      }
      for (const c of draw.circles) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [circleRing(c.lng, c.lat, c.radius)] },
          properties: {
            color: c.color ?? DEFAULTS.circle.color,
            opacity: c.opacity ?? DEFAULTS.circle.opacity,
            outline: c.color ?? DEFAULTS.circle.color,
            title: c.title ?? null,
            body: c.body ?? null,
            group: c.group ?? null,
          },
        })
      }
      // Routes are placeholders until the router responds: start as a straight
      // endpoint line, swap in the resolved street geometry (with distance /
      // duration) when it arrives, and keep the straight line if it never does.
      const routeFeatureIdx: number[] = []
      draw.routes.forEach((r) => {
        routeFeatureIdx.push(features.length)
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [r.from.lng, r.from.lat],
              ...r.via.map<[number, number]>((p) => [p.lng, p.lat]),
              [r.to.lng, r.to.lat],
            ],
          },
          properties: {
            color: r.color ?? DEFAULTS.route.color,
            width: r.width ?? DEFAULTS.route.width,
            opacity: r.opacity ?? DEFAULTS.route.opacity,
            title: r.title ?? null,
            body: r.body ?? null,
            group: r.group ?? null,
          },
        })
      })
      if (features.length > 0) {
        map.addSource('maplink-draw', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        })
        map.addLayer({
          id: 'maplink-area',
          type: 'fill',
          source: 'maplink-draw',
          filter: ['==', '$type', 'Polygon'],
          paint: {
            'fill-color': ['coalesce', ['get', 'color'], DEFAULTS.area.color],
            'fill-opacity': ['coalesce', ['get', 'opacity'], DEFAULTS.area.opacity],
          },
        })
        map.addLayer({
          id: 'maplink-area-outline',
          type: 'line',
          source: 'maplink-draw',
          filter: ['==', '$type', 'Polygon'],
          paint: {
            'line-color': ['coalesce', ['get', 'outline'], DEFAULTS.area.color],
            'line-width': 2,
          },
        })
        map.addLayer({
          id: 'maplink-line',
          type: 'line',
          source: 'maplink-draw',
          filter: ['==', '$type', 'LineString'],
          paint: {
            'line-color': ['coalesce', ['get', 'color'], DEFAULTS.line.color],
            'line-width': ['coalesce', ['get', 'width'], DEFAULTS.line.width],
            'line-opacity': ['coalesce', ['get', 'opacity'], DEFAULTS.line.opacity],
          },
        })
        for (const layerId of ['maplink-area', 'maplink-line']) {
          map.on('click', layerId, (e) => {
            const f = e.features?.[0]
            if (!f) return
            const html = featurePopupHtml(f)
            if (html) new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setHTML(html).addTo(map)
          })
          map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer'
          })
          map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = ''
          })
        }
      }

      // >50 markers render as a GL circle layer instead of DOM nodes.
      if (usePointsLayer) {
        map.addSource('maplink-points', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: draw.markers.map((m, i) => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
              properties: {
                color: m.color ?? DEFAULTS.marker.color,
                title: m.title ?? m.label ?? `Marker ${i + 1}`,
                body: m.body ?? null,
                group: m.group ?? null,
              },
            })),
          },
        })
        map.addLayer({
          id: 'maplink-points',
          type: 'circle',
          source: 'maplink-points',
          paint: {
            'circle-radius': 8,
            'circle-color': ['coalesce', ['get', 'color'], DEFAULTS.marker.color],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2,
          },
        })
        map.on('click', 'maplink-points', (e) => {
          const f = e.features?.[0]
          if (!f) return
          const html = featurePopupHtml(f)
          if (html) new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setHTML(html).addTo(map)
        })
      }

      // Raw GeoJSON passthrough: one source, fixed-paint layers per geometry
      // type. Intentionally outside the panel/group/popup machinery — a direct
      // translation of the document into MapLibre.
      if (draw.json.length > 0) {
        map.addSource('maplink-json', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: draw.json } as never,
        })
        map.addLayer({
          id: 'maplink-json-area',
          type: 'fill',
          source: 'maplink-json',
          filter: ['==', '$type', 'Polygon'],
          paint: {
            'fill-color': DEFAULTS.area.color,
            'fill-opacity': DEFAULTS.area.opacity,
          },
        })
        map.addLayer({
          id: 'maplink-json-area-outline',
          type: 'line',
          source: 'maplink-json',
          filter: ['==', '$type', 'Polygon'],
          paint: { 'line-color': DEFAULTS.area.color, 'line-width': 2 },
        })
        map.addLayer({
          id: 'maplink-json-line',
          type: 'line',
          source: 'maplink-json',
          filter: ['==', '$type', 'LineString'],
          paint: {
            'line-color': DEFAULTS.line.color,
            'line-width': DEFAULTS.line.width,
          },
        })
        map.addLayer({
          id: 'maplink-json-points',
          type: 'circle',
          source: 'maplink-json',
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 8,
            'circle-color': DEFAULTS.marker.color,
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2,
          },
        })
      }

      // The layers exist now, so sync the panel's initial group filter.
      panel?.applyGroup(initialGroup ?? null)

      // Auto-fit everything unless the URL pins the view. Called again after
      // routes resolve, so the fit can widen to the real street geometry.
      routeGeom = draw.routes.map(
        (r) => ({
          group: r.group,
          pts: [
            [r.from.lng, r.from.lat] as [number, number],
            ...r.via.map((p) => [p.lng, p.lat] as [number, number]),
            [r.to.lng, r.to.lat],
          ],
        }),
      )
      autoFit = () => {
        if (draw.center || draw.zoom) return
        const bounds = new maplibregl.LngLatBounds()
        let has = false
        const inGroup = (g: string | undefined) => !initialGroup || g === initialGroup
        const extend = (lng: number, lat: number) => {
          bounds.extend([lng, lat])
          has = true
        }
        for (const m of draw.markers) if (inGroup(m.group)) extend(m.lng, m.lat)
        for (const p of draw.popups) if (inGroup(p.group)) extend(p.lng, p.lat)
        for (const l of draw.lines) {
          if (inGroup(l.group)) for (const [lng, lat] of l.pts) extend(lng, lat)
        }
        for (const a of draw.areas) {
          if (inGroup(a.group)) for (const [lng, lat] of a.pts) extend(lng, lat)
        }
        for (const c of draw.circles) {
          if (!inGroup(c.group)) continue
          for (const [lng, lat] of circleRing(c.lng, c.lat, c.radius, 16)) extend(lng, lat)
        }
        for (const rg of routeGeom) {
          if (!inGroup(rg.group)) continue
          for (const [lng, lat] of rg.pts) extend(lng, lat)
        }
        // Raw GeoJSON has no group, so it always participates in the fit.
        for (const f of draw.json) eachCoord(f.geometry, extend)
        if (has) {
          map.fitBounds(bounds, {
            padding: { top: 80, right: 80, bottom: 80, left: panelPaddingLeft },
            maxZoom: 16,
            duration: 0,
          })
        }
      }
      autoFit()

      if (draw.routes.length > 0) resolveRoutes(draw.routes, routeFeatureIdx, features)
    })

    return () => {
      for (const c of controllers) c.abort()
      panel?.destroy()
      for (const m of markers) m.remove()
      for (const p of popups) p.remove()
      map.remove()
    }
  }, [])

  return (
    <div className="maplink-root">
      <div ref={containerRef} className="maplink-map" />
      <div ref={overlayRef} className="maplink-overlay" />
    </div>
  )
}

export default App
