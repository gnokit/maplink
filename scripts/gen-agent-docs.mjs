#!/usr/bin/env node
// Generates agent-facing static files from src/maplink.schema.json:
//   public/.well-known/maplink.schema.json  machine-readable grammar
//   public/llms.txt                         short index for LLMs
//   public/llms-full.txt                    full docs (README.md verbatim)
//
// Run with `npm run gen:agent` (wired into predev + prebuild).
// Dependency-free: node built-ins only, so it also runs on Vercel.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schema = JSON.parse(readFileSync(resolve(root, 'src/maplink.schema.json'), 'utf8'))
const readme = readFileSync(resolve(root, 'README.md'), 'utf8')

const publicDir = resolve(root, 'public')
function out(rel, contents) {
  const file = resolve(publicDir, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents)
  console.log(`gen:agent  public/${rel} (${contents.length} bytes)`)
}

const base = String(schema.baseUrl).replace(/\/$/, '')
const enc = schema.encoding
const zoom = schema.view.zoom

const aliasPart = (d) =>
  d.aliases && d.aliases.length ? ` (alias ${d.aliases.map((a) => `\`${a}\``).join(', ')})` : ''

const drawableLines = schema.drawables
  .map((d) => {
    const req = d.required && d.required.length ? ` Required: ${d.required.join(', ')}.` : ''
    return `- \`${d.key}\`${aliasPart(d)} \u2014 ${d.description}${req}`
  })
  .join('\n')

const aliasLine = Object.entries(schema.fieldAliases)
  .map(([long, short]) => `\`${long}\`\u2192\`${short}\``)
  .join(', ')

const escapeLines = Object.entries(enc.escapes)
  .map(([k, v]) => `- Write a literal separator as \`${k}\` (${v}).`)
  .join('\n')

const encodeLines = Object.entries(enc.urlEncode)
  .map(([k, v]) => `- \`${k}\` \u2192 \`${v}\``)
  .join('\n')

const llms = `# ${schema.name}

> ${schema.summary}

Base URL: ${base}

## Drawables

${drawableLines}

## Field aliases (preferred)

Drawable fields accept one-letter aliases (long names still work). Hex colours may omit the leading \`#\`, e.g. \`c:2563eb\`.

${aliasLine}

## View

- \`center={lat}|{lng}\` \u2014 initial map center
- \`zoom={n}\` \u2014 ${zoom.min}\u2013${zoom.max} (default ${zoom.default})
- \`style\` \u2014 ${schema.enums.style.join(', ')} (default ${schema.defaultStyle})

## Panel

- \`title={text}\` \u2014 heading for the optional left-hand list of drawables
- \`panel={0|1}\` \u2014 force the list open or closed (default: auto)
- \`group={name}\` \u2014 category chip selected on load
- Drawables accept \`group\` and \`subtitle\`; chips filter both the list and the map, and clicking a row focuses the drawable.

## Encoding

- ${enc.repeatable}
- ${enc.fieldFormat}
- Point drawables require \`lat\` and \`lng\`; \`line\` / \`area\` require \`pts\`; \`route\` requires \`from\` and \`to\`. Coordinates are \`lat,lng\`, separated by \`${enc.listSeparator}\`.
- \`json={GeoJSON}\` is a raw passthrough: the whole value must be percent-encoded (\`encodeURIComponent\`) and it bypasses the \`key:value\` grammar — no panel/group/popup. Repeatable.
${escapeLines}
${encodeLines}
- Unknown keys are ignored, malformed entries are skipped, max ${enc.maxPerType} per type (\`route\`: ${enc.maxRoutesPerType}, since each costs the visitor a routing request).

## Full documentation

- Full API reference: ${base}${schema.docs.llmsFullTxt}
- Machine-readable schema: ${base}${schema.docs.schema}
`

out('.well-known/maplink.schema.json', JSON.stringify(schema, null, 2) + '\n')
out('llms.txt', llms)
out('llms-full.txt', readme)
