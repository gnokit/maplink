// Share control — copy the link, share it, show a QR code, hand out an
// <iframe> embed snippet.
//
// The URL *is* the map's state, so sharing is just handing the URL over. This
// module is loaded lazily (`await import('./share')`) and only when the URL asks
// for it with `share=1`, so links without it never download this chunk.
//
// Everything here is plain DOM: no React, and only a type-level import from
// maplibre (the control is registered with `map.addControl`).

import type { IControl, Map } from 'maplibre-gl'

export type ShareOptions = {
  /** The page URL — the map's state lives in the query string. */
  url: () => string
  /** The same URL with the live map view (center/zoom) baked in. */
  viewUrl: () => string
  /** A chrome-free URL for embedding in an iframe. */
  embedUrl: () => string
}

// ---------------------------------------------------------------------------
// QR codes
// ---------------------------------------------------------------------------

type QrCode = {
  addData(data: string, mode?: 'Numeric' | 'Alphanumeric' | 'Byte' | 'Kanji'): void
  make(): void
  getModuleCount(): number
  isDark(row: number, col: number): boolean
}

type QrFactory = (typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H') => QrCode

// `qrcode-generator` is published as CommonJS (`export =`) but ships an ESM
// build with a default export — normalise both shapes so the import works
// regardless of the bundler's interop.
async function loadQrFactory(): Promise<QrFactory> {
  const mod = (await import('qrcode-generator')) as unknown as
    | QrFactory
    | { default: QrFactory }
  return typeof mod === 'function' ? mod : mod.default
}

// Quiet zone in modules (the spec's minimum is 4).
const QR_QUIET_ZONE = 4

/**
 * Draw `text` as a QR code. Returns false when the payload does not fit.
 */
function renderQr(canvas: HTMLCanvasElement, text: string, factory: QrFactory): boolean {
  const qr = factory(0, 'M')
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  const total = count + QR_QUIET_ZONE * 2
  const cell = Math.max(1, Math.floor(256 / total))
  const size = cell * total
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#111827'
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue
      ctx.fillRect(
        (col + QR_QUIET_ZONE) * cell,
        (row + QR_QUIET_ZONE) * cell,
        cell,
        cell,
      )
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Copy to the clipboard, falling back to a hidden textarea when the async
 *  Clipboard API is unavailable or blocked (non-secure context). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/** The `<iframe>` snippet that embeds this map. */
export function buildEmbedSnippet(embedUrl: string, height = 480): string {
  const src = embedUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<iframe src="${src}" width="100%" height="${height}" style="border:0" loading="lazy" title="maplink"></iframe>`
}

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

const SHARE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M18 16.08a2.9 2.9 0 0 0-1.96.77L8.91 12.7a3.3 3.3 0 0 0 0-1.4l7.05-4.11A2.9 2.9 0 1 0 15 5a3.3 3.3 0 0 0 .05.7L8.04 9.79a2.9 2.9 0 1 0 0 4.42l7.12 4.16a2.9 2.9 0 1 0 2.84-2.29Z"/>' +
  '</svg>'

export function createShareControl(opts: ShareOptions): IControl {
  let button: HTMLButtonElement | null = null
  let pop: HTMLElement | null = null

  function closePop() {
    if (!pop) return
    pop.remove()
    pop = null
    button?.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onDocPointerDown, true)
    document.removeEventListener('keydown', onDocKeydown, true)
    window.removeEventListener('resize', closePop)
    window.removeEventListener('scroll', closePop, true)
  }

  function onDocPointerDown(e: PointerEvent) {
    if (!pop) return
    const target = e.target as Node | null
    if (target && pop.contains(target)) return
    if (target && button?.contains(target)) return
    closePop()
  }

  function onDocKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closePop()
  }

  function toast(host: HTMLElement, message: string) {
    const note = el('div', 'maplink-share__toast', message)
    host.appendChild(note)
    window.setTimeout(() => note.remove(), 1600)
  }

  async function copyInto(host: HTMLElement, text: string, label: string) {
    const ok = await copyText(text)
    toast(host, ok ? `已複製${label}` : '複製失敗，請手動選取')
    if (!ok) return
    // Selecting the text makes a manual copy possible even when the clipboard
    // API was blocked.
    const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '.maplink-share__url, .maplink-share__embed',
    )
    field?.select()
  }

  function buildPop(anchor: HTMLElement) {
    const box = el('div', 'maplink-share__pop')
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', '分享此地圖')

    // --- link -------------------------------------------------------------
    const linkSection = el('div', 'maplink-share__section')
    linkSection.appendChild(el('div', 'maplink-share__label', '連結'))
    const urlRow = el('div', 'maplink-share__row')
    const urlInput = el('input', 'maplink-share__url')
    urlInput.type = 'text'
    urlInput.readOnly = true
    urlInput.value = opts.url()
    urlInput.setAttribute('aria-label', '目前連結')
    const copyBtn = el('button', 'maplink-share__btn', '複製')
    copyBtn.type = 'button'
    copyBtn.addEventListener('click', () => void copyInto(box, opts.url(), '連結'))
    urlRow.append(urlInput, copyBtn)
    linkSection.appendChild(urlRow)

    const viewBtn = el('button', 'maplink-share__wide', '複製目前視角連結')
    viewBtn.type = 'button'
    viewBtn.title = '把目前地圖的中心與縮放寫進連結'
    viewBtn.addEventListener('click', () => void copyInto(box, opts.viewUrl(), '目前視角連結'))
    linkSection.appendChild(viewBtn)
    box.appendChild(linkSection)

    // --- native share -----------------------------------------------------
    if (typeof navigator.share === 'function') {
      const shareBtn = el('button', 'maplink-share__wide', '分享…')
      shareBtn.type = 'button'
      shareBtn.addEventListener('click', () => {
        navigator
          .share({ title: 'maplink', url: opts.url() })
          .catch(() => {
            /* the user dismissed the share sheet */
          })
      })
      box.appendChild(shareBtn)
    }

    // --- QR ---------------------------------------------------------------
    const qrSection = el('div', 'maplink-share__section')
    qrSection.appendChild(el('div', 'maplink-share__label', 'QR'))
    const qrRow = el('div', 'maplink-share__row')
    const canvas = el('canvas', 'maplink-share__qr')
    canvas.width = 168
    canvas.height = 168
    const qrNote = el('div', 'maplink-share__note', '載入中…')
    const dlBtn = el('button', 'maplink-share__btn', '下載 PNG')
    dlBtn.type = 'button'
    dlBtn.disabled = true
    const qrSide = el('div', 'maplink-share__qrside')
    qrSide.appendChild(qrNote)
    qrRow.append(canvas, qrSide, dlBtn)
    qrSection.appendChild(qrRow)
    box.appendChild(qrSection)

    void loadQrFactory()
      .then((factory) => {
        if (!pop) return
        let ok = false
        try {
          ok = renderQr(canvas, opts.url(), factory)
        } catch {
          ok = false
        }
        if (!ok) {
          qrNote.textContent = '連結太長，無法產生 QR'
          canvas.style.display = 'none'
          return
        }
        qrNote.textContent = ''
        dlBtn.disabled = false
        dlBtn.addEventListener('click', () => {
          canvas.toBlob((blob) => {
            if (!blob) return
            const href = URL.createObjectURL(blob)
            const a = el('a')
            a.href = href
            a.download = 'maplink-qr.png'
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(href)
          }, 'image/png')
        })
      })
      .catch(() => {
        qrNote.textContent = 'QR 產生失敗'
        canvas.style.display = 'none'
      })

    // --- embed ------------------------------------------------------------
    const embedSection = el('div', 'maplink-share__section')
    embedSection.appendChild(el('div', 'maplink-share__label', '嵌入碼'))
    const embedRow = el('div', 'maplink-share__row')
    const embedArea = el('textarea', 'maplink-share__embed')
    embedArea.readOnly = true
    embedArea.rows = 2
    embedArea.value = buildEmbedSnippet(opts.embedUrl())
    embedArea.setAttribute('aria-label', '嵌入碼')
    const embedCopy = el('button', 'maplink-share__btn', '複製')
    embedCopy.type = 'button'
    embedCopy.addEventListener('click', () => void copyInto(box, embedArea.value, '嵌入碼'))
    embedRow.append(embedArea, embedCopy)
    embedSection.appendChild(embedRow)
    box.appendChild(embedSection)

    // Position under the button, clamped to the viewport.
    document.body.appendChild(box)
    const rect = anchor.getBoundingClientRect()
    const width = box.offsetWidth
    const height = box.offsetHeight
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    const top = Math.min(rect.bottom + 8, window.innerHeight - height - 8)
    box.style.left = `${Math.round(left)}px`
    box.style.top = `${Math.round(Math.max(8, top))}px`
    return box
  }

  return {
    onAdd(_m: Map): HTMLElement {
      const container = el('div', 'maplibregl-ctrl maplink-share')
      const btn = el('button', 'maplink-share__trigger')
      btn.type = 'button'
      btn.title = '分享此地圖'
      btn.setAttribute('aria-label', '分享此地圖')
      btn.setAttribute('aria-expanded', 'false')
      btn.innerHTML = SHARE_ICON
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (pop) {
          closePop()
          return
        }
        pop = buildPop(btn)
        btn.setAttribute('aria-expanded', 'true')
        document.addEventListener('pointerdown', onDocPointerDown, true)
        document.addEventListener('keydown', onDocKeydown, true)
        window.addEventListener('resize', closePop)
        window.addEventListener('scroll', closePop, true)
      })
      container.appendChild(btn)
      button = btn
      return container
    },
    onRemove(): void {
      closePop()
      button = null
    },
  }
}
