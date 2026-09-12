import { watch as watchDirectory } from 'node:fs'
import * as fs from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { stripPngTextMetadata } from '../codecs/card-png.js'
import { parseBaseline, readCardDirectoryBinding, readOptional, safePath } from './card-directory.js'

const imageTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
}

export function createCardDirectoryMedia(options: { dataRoot: string }) {
  const root = resolve(options.dataRoot)
  return {
    async read(cardId: string, kind: 'avatar' | 'background', assetId?: string): Promise<{ bytes: Uint8Array; mediaType: string } | undefined> {
      const binding = await readCardDirectoryBinding(root, cardId)
      const baselineBytes = await readOptional(root, `.loom/card-directories/${cardId}/baseline.json`)
      if (!baselineBytes) return undefined
      const baseline = JSON.parse(baselineBytes.toString('utf8'))
      parseBaseline(baseline, cardId)
      if (!baseline.mediaRefs) return undefined
      const key = kind === 'avatar' ? 'avatarAssetId' : 'coverAssetId'
      if (typeof baseline.mediaRefs !== 'object' || Array.isArray(baseline.mediaRefs)
        || Object.values(baseline.mediaRefs).some(value => typeof value !== 'string')) throw new Error('Invalid card directory media references')
      if (baseline.mediaRefs[key] !== assetId) return undefined
      const directory = await safePath(root, `characters/${binding?.directoryName ?? cardId}`)
      const manifestBytes = await readOptional(directory, 'manifest.json', 4 * 1024 * 1024)
      if (!manifestBytes) throw new Error('Card directory manifest is missing')
      const manifest = JSON.parse(manifestBytes.toString('utf8'))
      if (manifest.schema !== 'loom.cardBundle.zip.v1' && manifest.schema !== 'loom.cardBundle.zip.v2') throw new Error('Invalid Card directory manifest')
      const path = manifest.media?.[kind]
      if (path === undefined) return undefined
      if (typeof path !== 'string') throw new Error('Invalid Card directory media path')
      const mediaType = imageTypes[extname(path).toLowerCase()]
      if (!mediaType) throw new Error('Card directory media must be a raster image')
      const bytes = await readOptional(directory, path)
      if (!bytes) throw new Error(`Card directory media is missing: ${path}`)
      if (!matchesImageType(bytes, mediaType)) throw new Error('Card directory media content is not the declared raster image type')
      return { bytes: mediaType === 'image/png' ? stripPngTextMetadata(bytes) : bytes, mediaType }
    },
    async watch(onChange: () => void): Promise<{ dispose(): void }> {
      const characters = await safePath(root, 'characters')
      await fs.mkdir(characters, { recursive: true })
      let timer: ReturnType<typeof setTimeout> | undefined
      const watcher = watchDirectory(characters, { recursive: true }, (event, filename) => {
        if (filename && !imageTypes[extname(filename).toLowerCase()]
          && basename(filename) !== 'manifest.json' && event !== 'rename') return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { timer = undefined; onChange() }, 100)
      })
      watcher.on('error', error => console.error('Card directory media watcher failed', error))
      return { dispose: () => { watcher.close(); clearTimeout(timer) } }
    },
  }
}

function matchesImageType(bytes: Buffer, mediaType: string): boolean {
  switch (mediaType) {
    case 'image/png': return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    case 'image/jpeg': return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case 'image/gif': return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
    case 'image/webp': return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    case 'image/avif': {
      if (bytes.toString('ascii', 4, 8) !== 'ftyp') return false
      const end = bytes.readUInt32BE(0)
      if (end < 16 || end > bytes.length) return false
      for (let offset = 8; offset + 4 <= end; offset += 4) {
        if (offset !== 12 && ['avif', 'avis'].includes(bytes.toString('ascii', offset, offset + 4))) return true
      }
      return false
    }
    default: return false
  }
}
