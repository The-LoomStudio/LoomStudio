import { applicationDocumentTypes, type ApplicationRuntimeOptions, type BlobStorage, type ExtensionInstallationContent, type LoomScriptContent, type LoomScriptMountContent } from '@loom-studio/application-runtime'
import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import { parseLoomScriptSource } from '@loom-studio/shared/loom-scripts'
import type { JsonValue } from '@loom-studio/shared'
import { parseExtensionManifest } from '@loom-studio/extension-host'
import { extensionInstallationId, installedExtensionContributionId } from '@loom-studio/extension-sdk'
import { zipSync } from 'fflate'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { maxPackageBytes, readExtensionPackageZip } from './extension-package-installer.js'

export function createExtensionScriptArchiveExporter(options: {
  documents: DocumentStore
  blobs: BlobStorage
}): NonNullable<ApplicationRuntimeOptions['exportExtensionArchive']> {
  return async input => {
    const installation = await options.documents.get(input.installationId)
    if (!installation) return input.archive
    if (installation.type !== applicationDocumentTypes.extensionInstallation) throw new Error(`Invalid Extension installation: ${input.installationId}`)
    const installed = installation.content as ExtensionInstallationContent
    if (installed.packageId !== input.packageId || extensionInstallationId(input.packageId, installed.target) !== input.installationId) {
      throw new Error(`Extension installation does not own the exported package: ${input.packageId}`)
    }
    if (installed.packageVersion !== input.version) throw new Error(`Extension archive version differs from its installed scripts: ${input.packageId}`)

    const files = readExtensionPackageZip(input.archive)
    const paths = new Map<string, string>()
    for (const path of Object.keys(files)) {
      const normalized = posix.normalize(path)
      if (paths.has(normalized)) throw new Error(`Extension archive contains an ambiguous path: ${path}`)
      paths.set(normalized, path)
    }
    let manifestPath = paths.get('manifest.json')
    if (!manifestPath) {
      const roots = new Set([...paths.keys()].filter(path => path !== '.').map(path => path.split('/')[0]!))
      if (roots.size === 1) manifestPath = paths.get(`${[...roots][0]}/manifest.json`)
    }
    if (!manifestPath) throw new Error('Extension archive must contain manifest.json at its root or in a single wrapper directory')
    const manifest = parseExtensionManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files[manifestPath]!)))
    if (manifest.id !== input.packageId || manifest.version !== input.version) throw new Error(`Extension archive identity changed before export: ${input.packageId}`)
    const originalManifest = JSON.stringify(manifest)
    const root = posix.dirname(posix.normalize(manifestPath))
    const replacements = new Map<string, Uint8Array>()
    let changed = false
    let totalBytes = Object.values(files).reduce((sum, bytes) => sum + bytes.byteLength, 0)
    function replaceEntry(path: string, bytes: Uint8Array): void {
      const previous = replacements.get(path)
      if (previous && !Buffer.from(previous).equals(bytes)) throw new Error(`Extension Script contributions have conflicting saved content for: ${path}`)
      replacements.set(path, bytes)
      if (!files[path] || !Buffer.from(files[path]).equals(bytes)) {
        totalBytes += bytes.byteLength - (files[path]?.byteLength ?? 0)
        if (totalBytes > maxPackageBytes) throw new Error('Extension Package exceeds the local install size limit')
        files[path] = bytes
        changed = true
      }
    }
    async function listDocuments<T extends JsonValue>(type: string): Promise<Array<DocumentRecord<T>>> {
      const records: Array<DocumentRecord<T>> = []
      let cursor: string | undefined
      do {
        const page = await options.documents.list({ type, cursor, limit: 100, includeTombstone: true })
        records.push(...page.items as Array<DocumentRecord<T>>)
        cursor = page.nextCursor
      } while (cursor)
      return records
    }
    const [allScripts, allMounts] = await Promise.all([
      listDocuments<LoomScriptContent>(applicationDocumentTypes.loomScript),
      listDocuments<LoomScriptMountContent>(applicationDocumentTypes.loomScriptMount),
    ])
    const scripts = allScripts.filter(item => item.content.owner.kind === 'extension'
      && item.content.owner.installationId === input.installationId)
    const mounts = allMounts.filter(item => !item.meta.tombstone)
    const represented = new Set<string>()
    const removedScripts = new Set<string>()
    const removedRules = new Set<string>()
    const native = [] as NonNullable<NonNullable<typeof manifest.contributes>['loomScripts']>
    function orderFor(documentId: string) {
      const mount = mounts.find(item => item.content.scriptDocumentId === documentId
        && (installed.target.kind === 'card' ? item.content.target.kind === 'card' && item.content.target.cardId === installed.target.cardId : item.content.target.kind === 'user'))
      return mount ? { orderIndex: mount.content.orderIndex,
        ...(typeof mount.content.origin.groupOrder === 'number' ? { groupOrder: mount.content.origin.groupOrder } : {}) } : {}
    }
    for (const contribution of manifest.contributes?.loomScripts ?? []) {
      const scriptId = installedExtensionContributionId(input.packageId, installed.target, `${input.packageId}/script/${contribution.id}`)
      const document = allScripts.find(item => item.id === scriptId)
      if (!document) throw new Error(`Installed Extension Script is missing: ${scriptId}`)
      if (document.content.owner.kind !== 'extension' || document.content.owner.packageId !== input.packageId || document.content.owner.installationId !== input.installationId) throw new Error(`Installed Extension Script owner does not match its archive: ${scriptId}`)
      represented.add(document.id)
      if (document.meta.tombstone) { removedScripts.add(contribution.id); continue }
      const script = document.content
      // The saved filename can change when converting a JS rule to Markdown.
      const relative = posix.normalize(contribution.source)
      if (relative === '..' || relative.startsWith('../') || contribution.source.includes('\\')) throw new Error(`Extension Script path escapes its package: ${contribution.source}`)
      const source = contribution.source.endsWith('.md') === script.source.fileName.endsWith('.md') ? contribution.source : posix.join(posix.dirname(contribution.source), script.source.fileName)
      const normalizedPath = posix.join(root, source)
      replaceEntry(paths.get(normalizedPath) ?? normalizedPath, await options.blobs.read(script.source.blobId, { maxBytes: maxPackageBytes }))
      native.push({ ...contribution, source, ...orderFor(document.id) })
    }
    if (manifest.contributes?.transformRules?.length) {
      for (const contribution of manifest.contributes.transformRules) {
        const candidates = scripts.filter(document => document.content.owner.kind === 'extension'
          && document.content.owner.installationId === input.installationId
          && document.content.textResourceOrigin?.contributionId === contribution.id)
        if (candidates.length !== 1) throw new Error(`Installed text-rule Script is missing or ambiguous: ${contribution.id}`)
        const document = candidates[0]!
        represented.add(document.id)
        if (document.meta.tombstone) { removedRules.add(contribution.id); continue }
        const script = document.content
        const bytes = await options.blobs.read(script.source.blobId, { maxBytes: maxPackageBytes })
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        const metadata = parseLoomScriptSource(source)
        const primaryContributionId = Object.keys(script.textResourceIds ?? {}).find(id => metadata.contributions.some(item => item.kind === 'text-transform' && item.id === id))
        if (!primaryContributionId) throw new Error(`Packaged primary text rule was removed from Script: ${contribution.id}`)
        const mount = mounts.find(item => item.content.scriptDocumentId === document.id
          && (installed.target.kind === 'card' ? item.content.target.kind === 'card' && item.content.target.cardId === installed.target.cardId : item.content.target.kind === 'user'))
        const relative = posix.normalize(contribution.source)
        if (relative === '..' || relative.startsWith('../') || contribution.source.includes('\\')) throw new Error(`Extension text rule path escapes its package: ${contribution.source}`)
        const path = paths.get(posix.join(root, relative))
        if (!path || path.endsWith('/')) throw new Error(`Extension text rule archive entry is missing: ${contribution.source}`)
        // The existing manifest slot keeps its address; the complete source is authoritative on reimport.
        const artifact = { format: 'loom.script', schemaVersion: 1, fileName: script.source.fileName, source, primaryContributionId,
          ...(mount ? { enabled: mount.content.enabled, orderIndex: mount.content.orderIndex } : {}),
          ...(typeof mount?.content.origin.groupOrder === 'number' ? { groupOrder: mount.content.origin.groupOrder } : {}),
          ...(mount?.content.settings ? { settings: mount.content.settings } : {}),
        }
        replaceEntry(path, new TextEncoder().encode(JSON.stringify(artifact, null, 2)))
      }
    }
    for (const document of scripts) {
      if (document.meta.tombstone || represented.has(document.id)) continue
      const id = `local-${createHash('sha256').update(document.id).digest('hex').slice(0, 20)}`
      const source = `scripts/${id}/${document.content.source.fileName}`
      replaceEntry(posix.join(root, source), await options.blobs.read(document.content.source.blobId, { maxBytes: maxPackageBytes }))
      native.push({ id, source, ...orderFor(document.id) })
    }
    if (native.length || manifest.contributes?.loomScripts?.length || removedRules.size) {
      manifest.contributes ??= {}
      manifest.contributes.loomScripts = native
      if (removedRules.size) manifest.contributes.transformRules = manifest.contributes.transformRules?.filter(item => !removedRules.has(item.id))
      for (const preset of manifest.contributes.promptResources ?? []) {
        if (removedScripts.size) preset.scriptMounts = preset.scriptMounts?.filter(item => !removedScripts.has(item.scriptId))
        if (removedRules.size) preset.textUses = preset.textUses?.filter(item => item.kind !== 'rule' || item.reference.kind !== 'package' || !removedRules.has(item.reference.contributionId))
      }
      if (JSON.stringify(manifest) !== originalManifest) replaceEntry(manifestPath, new TextEncoder().encode(JSON.stringify(manifest, null, 2)))
    }
    if (!changed) return input.archive
    // Stable ZIP timestamps keep repeated exports and directory snapshots identical.
    const archive = zipSync(files, { mtime: new Date(1980, 0, 1) })
    if (archive.byteLength > maxPackageBytes) throw new Error('Extension Package exceeds the local install size limit')
    return archive
  }
}
