import {
  normalizeCardBundleArtifact,
  type CardBundleArtifact,
  type PortableExtensionPayloadArtifact,
} from '@loom-studio/application-runtime'
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from 'fflate'

const manifestPath = 'manifest.json'
const maxEntryCount = 80
const maxEntryBytes = 64 * 1024 * 1024
const maxBundleBytes = 128 * 1024 * 1024

type LoomCardPayloadManifest = Omit<PortableExtensionPayloadArtifact, 'content'> & {
  path: string
}

type LoomCardManifest = {
  schema: 'loom.cardBundle.zip.v1'
  artifact: Omit<CardBundleArtifact, 'extensionPayloads'>
  media?: {
    avatar?: string
    background?: string
  }
  extensionPayloads?: LoomCardPayloadManifest[]
}

export type CardBundleMedia = {
  bytes: Uint8Array
  mediaType: string
}

export function encodeCardBundleZip(input: {
  artifact: CardBundleArtifact
  avatar: CardBundleMedia
  background?: CardBundleMedia
}): Uint8Array {
  const artifact = normalizeCardBundleArtifact(input.artifact)
  const extensionPayloads = artifact.extensionPayloads ?? []
  delete artifact.card.media
  delete artifact.extensionPayloads
  const avatarPath = `assets/avatar${extensionForMediaType(input.avatar.mediaType)}`
  const backgroundPath = input.background
    ? `assets/background${extensionForMediaType(input.background.mediaType)}`
    : undefined
  const manifest: LoomCardManifest = {
    schema: 'loom.cardBundle.zip.v1',
    artifact,
    media: {
      avatar: avatarPath,
      ...(backgroundPath ? { background: backgroundPath } : {}),
    },
    extensionPayloads: extensionPayloads.map(payload => ({
      id: payload.id,
      packageId: payload.packageId,
      fileName: payload.fileName,
      format: payload.format,
      mediaType: payload.mediaType,
      ...(payload.schemaVersion !== undefined ? { schemaVersion: payload.schemaVersion } : {}),
      ...(payload.requirement !== undefined ? { requirement: payload.requirement } : {}),
      ...(payload.metadata !== undefined ? { metadata: payload.metadata } : {}),
      path: portablePayloadPath(payload),
    })),
  }
  const payloadEntries = Object.fromEntries(extensionPayloads.map(payload => [
    portablePayloadPath(payload),
    Buffer.from(payload.content, 'utf8'),
  ]))
  return zipSync({
    [manifestPath]: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    [avatarPath]: input.avatar.bytes,
    ...(backgroundPath && input.background ? { [backgroundPath]: input.background.bytes } : {}),
    ...payloadEntries,
  }, { level: 6 })
}

export async function decodeCardBundleZip(source: Uint8Array): Promise<{
  artifact: CardBundleArtifact
  avatar: CardBundleMedia
  background?: CardBundleMedia
}> {
  if (source.byteLength > maxBundleBytes) throw new Error(`Loom Card package exceeds ${maxBundleBytes} bytes`)
  const files = await unzipSafely(source)
  const manifestBytes = files.get(manifestPath)
  if (!manifestBytes) throw new Error('Loom Card package is missing manifest.json')
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as Partial<LoomCardManifest>
  if (manifest.schema !== 'loom.cardBundle.zip.v1' || !manifest.artifact || !manifest.media?.avatar) {
    throw new Error('Invalid Loom Card package manifest')
  }
  const avatar = readMedia(files, manifest.media.avatar)
  const background = manifest.media.background ? readMedia(files, manifest.media.background) : undefined
  const extensionPayloads = readExtensionPayloads(files, manifest.extensionPayloads)
  return {
    artifact: normalizeCardBundleArtifact({ ...manifest.artifact, extensionPayloads }),
    avatar,
    background,
  }
}

function unzipSafely(source: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    const files = new Map<string, Uint8Array>()
    let entryCount = 0
    let declaredTotal = 0
    let pending = 0
    let inputComplete = false
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const finish = () => {
      if (!settled && inputComplete && pending === 0) {
        settled = true
        resolve(files)
      }
    }
    const unzip = new Unzip(file => {
      try {
        validateArchivePath(file.name)
        entryCount += 1
        if (entryCount > maxEntryCount) throw new Error(`Loom Card package exceeds ${maxEntryCount} entries`)
        if (!Number.isSafeInteger(file.originalSize) || file.originalSize! < 0 || file.originalSize! > maxEntryBytes) {
          throw new Error(`Invalid or oversized ZIP entry: ${file.name}`)
        }
        declaredTotal += file.originalSize!
        if (declaredTotal > maxBundleBytes) throw new Error('Loom Card package expands beyond the allowed size')
        const chunks: Uint8Array[] = []
        let actualSize = 0
        pending += 1
        file.ondata = (error, data, final) => {
          if (error) {
            fail(error)
            return
          }
          actualSize += data.byteLength
          if (actualSize > file.originalSize! || actualSize > maxEntryBytes) {
            fail(new Error(`ZIP entry exceeds its declared size: ${file.name}`))
            return
          }
          chunks.push(data)
          if (!final) return
          files.set(file.name, Buffer.concat(chunks))
          pending -= 1
          finish()
        }
        file.start()
      } catch (error) {
        fail(error)
      }
    })
    unzip.register(UnzipPassThrough)
    unzip.register(UnzipInflate)
    try {
      unzip.push(source, true)
      inputComplete = true
      finish()
    } catch (error) {
      fail(error)
    }
  })
}

function validateArchivePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw new Error(`Unsafe ZIP entry path: ${path}`)
  }
}

function readMedia(files: Map<string, Uint8Array>, path: string): CardBundleMedia {
  validateArchivePath(path)
  const bytes = files.get(path)
  if (!bytes) throw new Error(`Loom Card package is missing ${path}`)
  return { bytes, mediaType: mediaTypeForPath(path) }
}

function readExtensionPayloads(
  files: Map<string, Uint8Array>,
  payloads: LoomCardPayloadManifest[] | undefined,
): PortableExtensionPayloadArtifact[] {
  if (payloads === undefined) return []
  if (!Array.isArray(payloads)) throw new Error('Invalid Loom Card extension payload manifest')
  return payloads.map((payload, index) => {
    if (!payload || typeof payload !== 'object' || typeof payload.path !== 'string') {
      throw new Error(`Invalid Loom Card extension payload manifest: ${index}`)
    }
    validateArchivePath(payload.path)
    if (!payload.path.startsWith('extensions/')) {
      throw new Error(`Loom Card extension payload path must stay under extensions/: ${payload.path}`)
    }
    const bytes = files.get(payload.path)
    if (!bytes) throw new Error(`Loom Card package is missing ${payload.path}`)
    return {
      id: payload.id,
      packageId: payload.packageId,
      fileName: payload.fileName,
      format: payload.format,
      mediaType: payload.mediaType,
      ...(payload.schemaVersion !== undefined ? { schemaVersion: payload.schemaVersion } : {}),
      ...(payload.requirement !== undefined ? { requirement: payload.requirement } : {}),
      ...(payload.metadata !== undefined ? { metadata: payload.metadata } : {}),
      content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    }
  })
}

function portablePayloadPath(payload: PortableExtensionPayloadArtifact): string {
  return `extensions/${payload.packageId}/${payload.id}/${payload.fileName}`
}

function extensionForMediaType(mediaType: string): string {
  switch (mediaType.toLowerCase()) {
    case 'image/jpeg': return '.jpg'
    case 'image/webp': return '.webp'
    case 'image/gif': return '.gif'
    default: return '.png'
  }
}

function mediaTypeForPath(path: string): string {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  switch (extension) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.png': return 'image/png'
    default: throw new Error(`Unsupported Card media type: ${path}`)
  }
}
