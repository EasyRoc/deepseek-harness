/**
 * Rasterize the Moldex mark into a macOS application icon PNG (1024×1024).
 *
 * Uses a rounded square matte so Dock and Finder match the in-app sidebar mark.
 * Committed output: `resources/icon-macos-moldex.png`. Rerun after changing
 * `packages/client/ui-account-moldex/src/client/moldex-mark.png`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const CANVAS = 1024
const CORNER_RADIUS = 224
const MARK_SCALE = 0.72

const markSource = fileURLToPath(new URL(
  '../../../packages/client/ui-account-moldex/src/client/moldex-mark.png',
  import.meta.url,
))
const output = fileURLToPath(new URL('../resources/icon-macos-moldex.png', import.meta.url))

const matte = Buffer.from(
  `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${CANVAS}" height="${CANVAS}" rx="${CORNER_RADIUS}" ry="${CORNER_RADIUS}" fill="#0d1117"/>
  </svg>`,
)

async function main(): Promise<void> {
  const markEdge = Math.round(CANVAS * MARK_SCALE)
  const inset = Math.round((CANVAS - markEdge) / 2)
  const mark = await sharp(await readFile(markSource))
    .resize(markEdge, markEdge, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const icon = await sharp(matte)
    .composite([{ input: mark, left: inset, top: inset }])
    .png()
    .toBuffer()
  await writeFile(output, icon)
  process.stdout.write(`desktop icon: wrote ${output}\n`)
}

await main()
