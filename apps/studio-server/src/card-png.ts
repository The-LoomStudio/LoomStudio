import type { CardBundleArtifact } from '@loom-studio/application-runtime'
import { deflateSync, inflateSync } from 'node:zlib'

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const loomKeyword = Buffer.from('loom', 'latin1')
const maxArtifactBytes = 16 * 1024 * 1024

export function encodeCardPng(source: Uint8Array, artifact: CardBundleArtifact): Uint8Array {
  const chunks = readPngChunks(source)
  const artifactJson = Buffer.from(JSON.stringify(artifact), 'utf8')
  if (artifactJson.byteLength > maxArtifactBytes) throw new Error(`Card Artifact exceeds ${maxArtifactBytes} bytes`)
  const text = deflateSync(artifactJson)
  const iTxtData = Buffer.concat([
    loomKeyword,
    Buffer.from([0, 1, 0, 0, 0]),
    text,
  ])
  const output: Uint8Array[] = [pngSignature]
  for (const chunk of chunks) {
    if (chunk.type === 'iTXt' && readKeyword(chunk.data) === 'loom') continue
    if (chunk.type === 'IEND') output.push(createChunk('iTXt', iTxtData))
    output.push(chunk.raw)
  }
  return Buffer.concat(output)
}

export function decodeCardPng(source: Uint8Array): CardBundleArtifact {
  for (const chunk of readPngChunks(source)) {
    if (chunk.type !== 'iTXt' || readKeyword(chunk.data) !== 'loom') continue
    const separators = readITxtSeparators(chunk.data)
    if (separators.compressionFlag !== 1 || separators.compressionMethod !== 0) {
      throw new Error('Unsupported Loom Card PNG compression')
    }
    const json = inflateSync(chunk.data.subarray(separators.textOffset), { maxOutputLength: maxArtifactBytes }).toString('utf8')
    return JSON.parse(json) as CardBundleArtifact
  }
  throw new Error('PNG does not contain a Loom Card iTXt chunk')
}

export function isPng(source: Uint8Array): boolean {
  return source.byteLength >= pngSignature.byteLength
    && Buffer.from(source).subarray(0, pngSignature.byteLength).equals(pngSignature)
}

export function createPolyglotCardPng(source: Uint8Array, archive: Uint8Array): Uint8Array {
  const png = Buffer.from(source).subarray(0, readPngEndOffset(source))
  return Buffer.concat([png, Buffer.from(archive)])
}

export function readPolyglotArchive(source: Uint8Array): Uint8Array | undefined {
  const offset = readPngEndOffset(source)
  const archive = Buffer.from(source).subarray(offset)
  return archive.byteLength >= 4
    && archive[0] === 0x50
    && archive[1] === 0x4b
    && archive[2] === 0x03
    && archive[3] === 0x04
    ? archive
    : undefined
}

export function readPngImageBytes(source: Uint8Array): Uint8Array {
  return Buffer.from(source).subarray(0, readPngEndOffset(source))
}

export const defaultCardPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function readPngChunks(source: Uint8Array): Array<{ type: string; data: Buffer; raw: Buffer }> {
  const bytes = Buffer.from(source)
  if (!isPng(bytes)) throw new Error('Expected a PNG file')
  const chunks: Array<{ type: string; data: Buffer; raw: Buffer }> = []
  let offset = pngSignature.byteLength
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new Error('Truncated PNG chunk')
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.byteLength) throw new Error('Truncated PNG chunk data')
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data, raw: bytes.subarray(offset, end) })
    offset = end
    if (type === 'IEND') break
  }
  if (chunks.at(-1)?.type !== 'IEND') throw new Error('PNG is missing IEND')
  return chunks
}

function readPngEndOffset(source: Uint8Array): number {
  const bytes = Buffer.from(source)
  if (!isPng(bytes)) throw new Error('Expected a PNG file')
  let offset = pngSignature.byteLength
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new Error('Truncated PNG chunk')
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.byteLength) throw new Error('Truncated PNG chunk data')
    if (bytes.toString('latin1', offset + 4, offset + 8) === 'IEND') return end
    offset = end
  }
  throw new Error('PNG is missing IEND')
}

function createChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'latin1')
  const chunk = Buffer.allocUnsafe(12 + data.byteLength)
  chunk.writeUInt32BE(data.byteLength, 0)
  typeBytes.copy(chunk, 4)
  Buffer.from(data).copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength)
  return chunk
}

function readKeyword(data: Buffer): string {
  const separator = data.indexOf(0)
  return separator < 0 ? '' : data.toString('latin1', 0, separator)
}

function readITxtSeparators(data: Buffer): { compressionFlag: number; compressionMethod: number; textOffset: number } {
  const keywordEnd = data.indexOf(0)
  if (keywordEnd < 0 || keywordEnd + 4 >= data.byteLength) throw new Error('Invalid PNG iTXt chunk')
  const languageEnd = data.indexOf(0, keywordEnd + 3)
  if (languageEnd < 0) throw new Error('Invalid PNG iTXt language tag')
  const translatedEnd = data.indexOf(0, languageEnd + 1)
  if (translatedEnd < 0) throw new Error('Invalid PNG iTXt translated keyword')
  return {
    compressionFlag: data[keywordEnd + 1]!,
    compressionMethod: data[keywordEnd + 2]!,
    textOffset: translatedEnd + 1,
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
