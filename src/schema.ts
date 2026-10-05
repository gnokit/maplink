// Single source of truth for the URL grammar and its defaults.
// The JSON is also emitted verbatim to /.well-known/maplink.schema.json and
// drives /llms.txt + /llms-full.txt at build time — see scripts/gen-agent-docs.mjs.
import schema from './maplink.schema.json'

export const MAP_SCHEMA = schema
export const MAX_PER_TYPE: number = schema.encoding.maxPerType
export const DOM_MARKER_LIMIT: number = schema.domMarkerLimit
export const STYLES: Record<string, string> = schema.styles
export const ANCHORS: Set<string> = new Set(schema.enums.anchor)
export const DEFAULTS = schema.defaults
export const DEFAULT_CENTER: [number, number] = [
  schema.view.center.default[0],
  schema.view.center.default[1],
]
export const DEFAULT_ZOOM: number = schema.view.zoom.default
