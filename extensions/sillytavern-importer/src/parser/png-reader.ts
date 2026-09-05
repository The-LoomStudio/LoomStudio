import type { SillyTavernCard } from '../types.js'

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function isPngFile(source: Uint8Array): boolean {
  return source.byteLength >= pngSignature.byteLength
    && Buffer.from(source).subarray(0, pngSignature.byteLength).equals(pngSignature)
}

export type PngChunk = {
  type: string
  data: Buffer
  raw: Buffer
}

export function readPngChunks(source: Uint8Array): PngChunk[] {
  const bytes = Buffer.from(source)
  if (!isPngFile(bytes)) {
    throw new Error('Expected a PNG file')
  }

  const chunks: PngChunk[] = []
  let offset = pngSignature.byteLength

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) {
      throw new Error('Truncated PNG chunk header')
    }
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.byteLength) {
      throw new Error('Truncated PNG chunk payload')
    }
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data, raw: bytes.subarray(offset, end) })
    offset = end
    if (type === 'IEND') break
  }

  if (chunks.at(-1)?.type !== 'IEND') {
    throw new Error('PNG file is missing IEND chunk')
  }
  return chunks
}

export function extractPngImageBytes(source: Uint8Array): Uint8Array {
  const bytes = Buffer.from(source)
  if (!isPngFile(bytes)) {
    throw new Error('Expected a PNG file')
  }

  let offset = pngSignature.byteLength
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) break
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.byteLength) break
    if (bytes.toString('latin1', offset + 4, offset + 8) === 'IEND') {
      return bytes.subarray(0, end)
    }
    offset = end
  }
  return source
}

export function extractStCardFromPng(source: Uint8Array): {
  card: SillyTavernCard
  format: 'st.card.v2' | 'st.card.v3'
  rawJson: string
} | null {
  try {
    const chunks = readPngChunks(source)
    let ccv3Match: { rawJson: string } | null = null
    let charaMatch: { rawJson: string } | null = null

    for (const chunk of chunks) {
      if (chunk.type === 'tEXt') {
        const nullIndex = chunk.data.indexOf(0x00)
        if (nullIndex <= 0) continue
        const keyword = chunk.data.subarray(0, nullIndex).toString('latin1')
        const textBytes = chunk.data.subarray(nullIndex + 1)

        if (keyword === 'ccv3') {
          const rawBase64 = textBytes.toString('utf8').trim()
          const rawJson = Buffer.from(rawBase64, 'base64').toString('utf8')
          ccv3Match = { rawJson }
        } else if (keyword === 'chara') {
          const rawBase64 = textBytes.toString('utf8').trim()
          const rawJson = Buffer.from(rawBase64, 'base64').toString('utf8')
          charaMatch = { rawJson }
        }
      }
    }

    if (ccv3Match) {
      const parsed = JSON.parse(ccv3Match.rawJson) as SillyTavernCard
      return {
        card: parsed,
        format: 'st.card.v3',
        rawJson: ccv3Match.rawJson,
      }
    }

    if (charaMatch) {
      const parsed = JSON.parse(charaMatch.rawJson) as SillyTavernCard
      return {
        card: parsed,
        format: 'st.card.v2',
        rawJson: charaMatch.rawJson,
      }
    }

    return null
  } catch {
    return null
  }
}
