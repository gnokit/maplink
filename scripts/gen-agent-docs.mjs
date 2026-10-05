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
  .map((d) => `- \`${d.key}\`${aliasPart(d)} \u2014 ${d.description} Required: ${d.required.join(', ')}.`)
  .join('\n')

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

## View

- \`center={lat}|{lng}\` \u2014 initial map center
- \`zoom={n}\` \u2014 ${zoom.min}\u2013${zoom.max} (default ${zoom.default})
- \`style\` \u2014 ${schema.enums.style.join(', ')} (default ${schema.defaultStyle})

## Encoding

- ${enc.repeatable}
- ${enc.fieldFormat}
- Point drawables require \`lat\` and \`lng\`; path drawables require \`pts\`. Coordinates are \`lat,lng\`, separated by \`${enc.listSeparator}\`.
${escapeLines}
${encodeLines}
- Unknown keys are ignored, malformed entries are skipped, max ${enc.maxPerType} per type.

## Full documentation

- Full API reference: ${base}${schema.docs.llmsFullTxt}
- Machine-readable schema: ${base}${schema.docs.schema}
`

out('.well-known/maplink.schema.json', JSON.stringify(schema, null, 2) + '\n')
out('llms.txt', llms)
out('llms-full.txt', readme)
