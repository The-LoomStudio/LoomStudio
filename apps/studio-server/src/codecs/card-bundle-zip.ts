import {
  normalizeCardBundleArtifact,
  type CardBundleArtifact,
  type PortableExtensionPayloadArtifact,
} from '@loom-studio/application-runtime'
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from 'fflate'
import { loadCardResourceFiles, projectCardFiles, restoreCardFiles, validateBundlePath, type CardFilesIndex } from './card-bundle-files.js'

const manifestPath = 'manifest.json'
// ponytail: bounded author projects; raise with streaming/file-tree budgets if larger worlds require it.
const maxEntryCount = 4096
const maxEntryBytes = 64 * 1024 * 1024
export const maxBundleBytes = 128 * 1024 * 1024

type LoomCardPayloadManifest = Omit<PortableExtensionPayloadArtifact, 'content'> & {
  path: string
}

type LoomScriptAttachmentArtifact = NonNullable<CardBundleArtifact['scriptAttachments']>[number]

type LegacyCardManifest = {
  schema: 'loom.cardBundle.zip.v1'
  artifact: Omit<CardBundleArtifact, 'extensionPayloads'>
  media?: {
    avatar?: string
    background?: string
  }
  extensionPayloads?: LoomCardPayloadManifest[]
  scriptAttachments?: Array<{
    orderIndex: number
    resourceOrigin?: 'card' | 'external'
    script: Omit<LoomScriptAttachmentArtifact['script'], 'source'> & { path: string }
  }>
}

type LoomCardManifest = Omit<LegacyCardManifest, 'schema' | 'artifact'> & {
  schema: 'loom.cardBundle.zip.v2'
  resources: CardFilesIndex
}

export type CardBundleMedia = {
  bytes: Uint8Array
  mediaType: string
}

export type CardBundleFilesInput = {
  artifact: CardBundleArtifact
  avatar: CardBundleMedia
  background?: CardBundleMedia
}

export function encodeCardBundleFiles(input: CardBundleFilesInput): Record<string, Uint8Array> {
  const artifact = structuredClone(normalizeCardBundleArtifact(input.artifact))
  const extensionPayloads = artifact.extensionPayloads ?? []
  const scriptAttachments = artifact.scriptAttachments ?? []
  delete artifact.card.media
  delete artifact.extensionPayloads
  delete artifact.scriptAttachments
  const avatarPath = `assets/avatar${extensionForMediaType(input.avatar.mediaType)}`
  const backgroundPath = input.background
    ? `assets/background${extensionForMediaType(input.background.mediaType)}`
    : undefined
  const resourceEntries: Record<string, Uint8Array> = {}
  const manifest: LoomCardManifest = {
    schema: 'loom.cardBundle.zip.v2',
    resources: projectCardFiles(artifact, resourceEntries),
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
      ...(payload.resourceOrigin !== undefined ? { resourceOrigin: payload.resourceOrigin } : {}),
      path: portablePayloadPath(payload),
    })),
    scriptAttachments: scriptAttachments.map((attachment, index) => ({
      orderIndex: attachment.orderIndex,
      ...(attachment.resourceOrigin !== undefined ? { resourceOrigin: attachment.resourceOrigin } : {}),
      script: {
        format: attachment.script.format,
        schemaVersion: attachment.script.schemaVersion,
        fileName: attachment.script.fileName,
        path: loomScriptPath(attachment, index),
      },
    })),
  }
  const payloadEntries = Object.fromEntries(extensionPayloads.map(payload => [
    portablePayloadPath(payload),
    Buffer.from(payload.content, 'utf8'),
  ]))
  const scriptEntries = Object.fromEntries(scriptAttachments.map((attachment, index) => [
    loomScriptPath(attachment, index),
    Buffer.from(attachment.script.source, 'utf8'),
  ]))
  const entries = {
    [manifestPath]: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    ...resourceEntries,
    [avatarPath]: input.avatar.bytes,
    ...(backgroundPath && input.background ? { [backgroundPath]: input.background.bytes } : {}),
    ...payloadEntries,
    ...scriptEntries,
  }
  let total = 0
  if (Object.keys(entries).length > maxEntryCount) throw new Error(`Loom Card package exceeds ${maxEntryCount} entries`)
  for (const [path, bytes] of Object.entries(entries)) {
    validateBundlePath(path)
    if (bytes.byteLength > maxEntryBytes) throw new Error(`Oversized ZIP entry: ${path}`)
    total += bytes.byteLength
  }
  if (total > maxBundleBytes) throw new Error('Loom Card package expands beyond the allowed size')
  return entries
}

export function encodeCardBundleZip(input: CardBundleFilesInput): Uint8Array {
  const entries = encodeCardBundleFiles(input)
  const archive = zipSync(entries, { level: 6 })
  if (archive.byteLength > maxBundleBytes) throw new Error(`Loom Card package exceeds ${maxBundleBytes} bytes`)
  return archive
}

export async function decodeCardBundleZip(source: Uint8Array): Promise<{
  artifact: CardBundleArtifact
  avatar: CardBundleMedia
  background?: CardBundleMedia
}> {
  if (source.byteLength > maxBundleBytes) throw new Error(`Loom Card package exceeds ${maxBundleBytes} bytes`)
  const files = await unzipSafely(source)
  return decodeCardBundleFiles(files)
}

export function decodeCardBundleFiles(files: Map<string, Uint8Array>): CardBundleFilesInput {
  const manifestBytes = files.get(manifestPath)
  if (!manifestBytes) throw new Error('Loom Card package is missing manifest.json')
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as LegacyCardManifest | LoomCardManifest
  if (!manifest || (manifest.schema !== 'loom.cardBundle.zip.v1' && manifest.schema !== 'loom.cardBundle.zip.v2') || !manifest.media?.avatar) {
    throw new Error('Invalid Loom Card package manifest')
  }
  const avatar = readMedia(files, manifest.media.avatar)
  const background = manifest.media.background ? readMedia(files, manifest.media.background) : undefined
  const extensionPayloads = readExtensionPayloads(files, manifest.extensionPayloads)
  const scriptAttachments = readScriptAttachments(files, manifest.scriptAttachments)
  const artifact = manifest.schema === 'loom.cardBundle.zip.v2'
    ? restoreCardFiles(manifest.resources, files)
    : manifest.artifact
  return {
    artifact: normalizeCardBundleArtifact({ ...artifact, extensionPayloads, scriptAttachments }),
    avatar,
    background,
  }
}

export async function loadCardBundleFiles(read: (path: string) => Promise<Uint8Array>) {
  const files = new Map<string, Uint8Array>()
  let total = 0
  const load = async (path: string): Promise<Uint8Array> => {
    validateBundlePath(path)
    const cached = files.get(path)
    if (cached) return cached
    if (files.size >= maxEntryCount) throw new Error(`Loom Card package exceeds ${maxEntryCount} entries`)
    const bytes = await read(path)
    if (bytes.byteLength > maxEntryBytes) throw new Error(`Oversized directory entry: ${path}`)
    total += bytes.byteLength
    if (total > maxBundleBytes) throw new Error('Loom Card package expands beyond the allowed size')
    files.set(path, bytes)
    return bytes
  }
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await load(manifestPath))) as LegacyCardManifest | LoomCardManifest
  if (!manifest || (manifest.schema !== 'loom.cardBundle.zip.v1' && manifest.schema !== 'loom.cardBundle.zip.v2') || !manifest.media?.avatar) {
    throw new Error('Invalid Loom Card package manifest')
  }
  if (manifest.schema === 'loom.cardBundle.zip.v2') await loadCardResourceFiles(manifest.resources, load)
  await load(manifest.media.avatar)
  if (manifest.media.background !== undefined) await load(manifest.media.background)
  for (const attachment of manifest.scriptAttachments ?? []) await load(attachment.script.path)
  for (const payload of manifest.extensionPayloads ?? []) await load(payload.path)
  return { bundle: decodeCardBundleFiles(files), files }
}

function readScriptAttachments(
  files: Map<string, Uint8Array>,
  attachments: LoomCardManifest['scriptAttachments'],
): LoomScriptAttachmentArtifact[] {
  if (attachments === undefined) return []
  if (!Array.isArray(attachments)) throw new Error('Invalid Loom Card Script attachment manifest')
  return attachments.map((attachment, index) => {
    if (!attachment || typeof attachment !== 'object'
      || !attachment.script || typeof attachment.script !== 'object'
      || typeof attachment.script.path !== 'string') {
      throw new Error(`Invalid Loom Card Script attachment manifest: ${index}`)
    }
    validateBundlePath(attachment.script.path)
    if (!(attachment.script.path.startsWith('scripts/') || attachment.script.path.startsWith('external/scripts/'))
      || !attachment.script.path.endsWith('.loom.js')) {
      throw new Error(`Loom Card Script path must stay under scripts/ or external/scripts/ and end in .loom.js: ${attachment.script.path}`)
    }
    const bytes = files.get(attachment.script.path)
    if (!bytes) throw new Error(`Loom Card package is missing ${attachment.script.path}`)
    return {
      orderIndex: attachment.orderIndex,
      ...(attachment.resourceOrigin !== undefined ? { resourceOrigin: attachment.resourceOrigin } : {}),
      script: {
        format: attachment.script.format,
        schemaVersion: attachment.script.schemaVersion,
        fileName: attachment.script.fileName,
        source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      },
    }
  })
}

function unzipSafely(source: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    const files = new Map<string, Uint8Array>()
    let entryCount = 0
    let declaredTotal = 0
    let actualTotal = 0
    let pending = 0
    let inputComplete = false
    let settled = false
    const seenPaths = new Set<string>()
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
        const directory = file.name.endsWith('/')
        validateBundlePath(directory ? file.name.slice(0, -1) : file.name)
        if (seenPaths.has(file.name)) throw new Error(`Duplicate ZIP entry path: ${file.name}`)
        seenPaths.add(file.name)
        entryCount += 1
        if (entryCount > maxEntryCount) throw new Error(`Loom Card package exceeds ${maxEntryCount} entries`)
        if (file.originalSize !== undefined && (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || file.originalSize > maxEntryBytes)) {
          throw new Error(`Invalid or oversized ZIP entry: ${file.name}`)
        }
        declaredTotal += file.originalSize ?? 0
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
          actualTotal += data.byteLength
          if ((file.originalSize !== undefined && actualSize > file.originalSize) || actualSize > maxEntryBytes
            || actualTotal > maxBundleBytes || (directory && actualSize !== 0)) {
            fail(new Error(`ZIP entry exceeds its declared size: ${file.name}`))
            return
          }
          chunks.push(data)
          if (!final) return
          if (file.originalSize !== undefined && actualSize !== file.originalSize) {
            fail(new Error(`ZIP entry size mismatch: ${file.name}`))
            return
          }
          if (!directory) files.set(file.name, Buffer.concat(chunks))
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
      const chunkSize = 64 * 1024
      for (let offset = 0; offset < source.byteLength && !settled; offset += chunkSize) {
        unzip.push(source.subarray(offset, offset + chunkSize), offset + chunkSize >= source.byteLength)
      }
      if (pending > 0 && !settled) throw new Error('Truncated Loom Card ZIP entry')
      inputComplete = true
      finish()
    } catch (error) {
      fail(error)
    }
  })
}

function readMedia(files: Map<string, Uint8Array>, path: string): CardBundleMedia {
  validateBundlePath(path)
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
    validateBundlePath(payload.path)
    if (!(payload.path.startsWith('extensions/') || payload.path.startsWith('external/extensions/'))) {
      throw new Error(`Loom Card extension payload path must stay under extensions/ or external/extensions/: ${payload.path}`)
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
      ...(payload.resourceOrigin !== undefined ? { resourceOrigin: payload.resourceOrigin } : {}),
    }
  })
}

function portablePayloadPath(payload: PortableExtensionPayloadArtifact): string {
  return `${payload.resourceOrigin === 'external' ? 'external/' : ''}extensions/${payload.packageId}/${payload.id}/${payload.fileName}`
}

function loomScriptPath(attachment: LoomScriptAttachmentArtifact, index: number): string {
  return `${attachment.resourceOrigin === 'external' ? 'external/' : ''}scripts/${index}-${attachment.script.fileName}`
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
