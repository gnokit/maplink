import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  ANCHORS,
  DEFAULTS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  DOM_MARKER_LIMIT,
  MAX_PER_TYPE,
  STYLES,
} from './schema'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

// ---------------------------------------------------------------------------
// URL drawable API (see conversation for spec):
//   m=lat:{}|lng:{}|label:{}|emoji:{}|color:{}|scale:{}|anchor:{}|offset:{x},{y}
//     |rotation:{}|opacity:{}|drag:{0|1}|title:{}|body:{}
//   popup=lat:{}|lng:{}|title:{}|body:{}
//   line=pts:{lat},{lng};…|color:{}|width:{}|opacity:{}|title:{}|body:{}
//   area=pts:{lat},{lng};…|color:{}|opacity:{}|outline:{}|title:{}|body:{}
//   circle=lat:{}|lng:{}|radius:{m}|color:{}|opacity:{}|title:{}|body:{}
//   center={lat}|{lng}  zoom={n}  style={bright|positron|liberty}
// All drawable params are repeatable. Only listed keys are read, malformed
// entries are ignored, max 100 entries per type. `\|` / `\:` escape separators.
// ---------------------------------------------------------------------------

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
}

type DrawPopup = { lat: number; lng: number; title?: string; body?: string }

type DrawLine = {
  pts: Array<[number, number]>
  color?: string
  width?: number
  opacity?: number
  title?: string
  body?: string
}

type DrawArea = {
  pts: Array<[number, number]>
  color?: string
  opacity?: number
  outline?: string
  title?: string
  body?: string
}

type DrawCircle = {
  lat: number
  lng: number
  radius: number
  color?: string
  opacity?: number
  title?: string
  body?: string
}

type GJFeature = {
  type: 'Feature'
  geometry:
    | { type: 'LineString'; coordinates: Array<[number, number]> }
    | { type: 'Polygon'; coordinates: Array<Array<[number, number]>> }
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
    rec[part.slice(0, idx).trim()] = part.slice(idx + 1)
  }
  return rec
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
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
  if (kv.color) m.color = kv.color
  const scale = num(kv.scale)
  if (scale !== undefined && scale > 0) m.scale = scale
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
  return m
}

function parsePopup(item: string): DrawPopup | undefined {
  const kv = parseKV(item)
  const ll = latLng(kv.lat, kv.lng)
  if (!ll) return undefined
  return { lat: ll.lat, lng: ll.lng, title: kv.title, body: kv.body }
}

function parseLine(item: string): DrawLine | undefined {
  const kv = parseKV(item)
  const pts = parsePts(kv.pts)
  if (!pts) return undefined
  const line: DrawLine = { pts }
  if (kv.color) line.color = kv.color
  const width = num(kv.width)
  if (width !== undefined && width > 0) line.width = width
  const opacity = num(kv.opacity)
  if (opacity !== undefined && opacity >= 0 && opacity <= 1) line.opacity = opacity
  if (kv.title) line.title = kv.title
  if (kv.body) line.body = kv.body
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
  if (kv.color) area.color = kv.color
  const opacity = num(kv.opacity)
  if (opacity !== undefined && opacity >= 0 && opacity <= 1) area.opacity = opacity
  if (kv.outline) area.outline = kv.outline
  if (kv.title) area.title = kv.title
  if (kv.body) area.body = kv.body
  return area
}

function parseCircle(item: string): DrawCircle | undefined {
  const kv = parseKV(item)
  const ll = latLng(kv.lat, kv.lng)
  const radius = num(kv.radius)
  if (!ll || radius === undefined || radius <= 0) return undefined
  const circle: DrawCircle = { lat: ll.lat, lng: ll.lng, radius }
  if (kv.color) circle.color = kv.color
  const opacity = num(kv.opacity)
  if (opacity !== undefined && opacity >= 0 && opacity <= 1) circle.opacity = opacity
  if (kv.title) circle.title = kv.title
  if (kv.body) circle.body = kv.body
  return circle
}

type DrawableSet = {
  markers: DrawMarker[]
  popups: DrawPopup[]
  lines: DrawLine[]
  areas: DrawArea[]
  circles: DrawCircle[]
  center?: [number, number]
  zoom?: number
  style: string
}

// Fallback data (Ho Man Tin parkings) when the URL carries no drawables.
const FALLBACK_MARKERS: DrawMarker[] = [
  {
    lat: 22.315203,
    lng: 114.181846,
    label: '1',
    emoji: '🏢',
    color: '#2563eb',
    title: '何文田停車場（何文田廣場）',
    body: '空位：🟢 30\n更新：14:05\n限高 1.8 米',
  },
  {
    lat: 22.316543,
    lng: 114.183219,
    label: '2',
    emoji: '🅿️',
    color: '#16a34a',
    title: '常樂街咪錶（近常盛街）',
    body: '空位：🟢 13／19\n更新：14:02\n$4／15 分鐘，最長 2 小時',
  },
  {
    lat: 22.312133,
    lng: 114.180687,
    label: '3',
    emoji: '🏢',
    color: '#2563eb',
    title: '何文田體育館停車場',
    body: '空位：🟢 21\n更新：14:03\n限高 2.45 米；首 2 小時 $5.6／半小時，之後 $8.4／半小時',
  },
  {
    lat: 22.311276,
    lng: 114.179285,
    label: '4',
    emoji: '🏢',
    color: '#2563eb',
    title: '愛民停車場（愛民廣場）',
    body: '空位：🟢 30\n更新：14:05\n限高 2 米',
  },
  {
    lat: 22.31581,
    lng: 114.186481,
    label: '5',
    emoji: '🅿️',
    color: '#16a34a',
    title: '靠背壟道咪錶（近浙江街）',
    body: '空位：🟢 16／78\n更新：14:05\n$4／15 分鐘，最長 2 小時',
  },
]

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
    circles.length > 0

  return {
    markers: hasUrlDrawables ? markers : FALLBACK_MARKERS,
    popups,
    lines,
    areas,
    circles,
    center,
    zoom,
    style,
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
    `width:${size}px;height:${size}px;border-radius:50%;background:${m.color ?? DEFAULTS.marker.color};color:#fff;` +
    `font:700 ${Math.round(14 * s)}px/${size}px system-ui,sans-serif;text-align:center;cursor:pointer;` +
    `border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5);`
  return el
}

function featurePopupHtml(f: maplibregl.MapGeoJSONFeature): string | undefined {
  const title = typeof f.properties.title === 'string' ? f.properties.title : undefined
  const body = typeof f.properties.body === 'string' ? f.properties.body : undefined
  if (!title && !body) return undefined
  return popupHtml(title, body)
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const draw = parseDrawables(window.location.search)

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: draw.style,
      center: draw.center ?? DEFAULT_CENTER,
      zoom: draw.zoom ?? DEFAULT_ZOOM,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // Markers + standalone popups don't depend on the style — add immediately.
    const usePointsLayer = draw.markers.length > DOM_MARKER_LIMIT
    const markers: maplibregl.Marker[] = []
    if (!usePointsLayer) {
      draw.markers.forEach((m, i) => {
        const marker = new maplibregl.Marker({
          element: markerElement(m, String(i + 1)),
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
          marker.getElement().style.opacity = String(m.opacity)
        }
        markers.push(marker)
      })
    }
    const popups = draw.popups
      .filter((p) => p.title || p.body)
      .map((p) =>
        new maplibregl.Popup({ offset: 24 })
          .setLngLat([p.lng, p.lat])
          .setHTML(popupHtml(p.title, p.body))
          .addTo(map),
      )

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
          },
        })
      }
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

      // Auto-fit everything unless the URL pins the view.
      if (!draw.center && !draw.zoom) {
        const bounds = new maplibregl.LngLatBounds()
        let has = false
        const extend = (lng: number, lat: number) => {
          bounds.extend([lng, lat])
          has = true
        }
        for (const m of draw.markers) extend(m.lng, m.lat)
        for (const p of draw.popups) extend(p.lng, p.lat)
        for (const l of draw.lines) for (const [lng, lat] of l.pts) extend(lng, lat)
        for (const a of draw.areas) for (const [lng, lat] of a.pts) extend(lng, lat)
        for (const c of draw.circles) {
          for (const [lng, lat] of circleRing(c.lng, c.lat, c.radius, 16)) extend(lng, lat)
        }
        if (has) map.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 0 })
      }
    })

    return () => {
      for (const m of markers) m.remove()
      for (const p of popups) p.remove()
      map.remove()
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />
}

export default App
