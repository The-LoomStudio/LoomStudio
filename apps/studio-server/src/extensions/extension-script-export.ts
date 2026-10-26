import { applicationDocumentTypes, type ApplicationRuntimeOptions, type BlobStorage, type ExtensionInstallationContent, type LoomScriptContent, type LoomScriptMountContent } from '@loom-studio/application-runtime'
import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import { parseLoomScriptSource } from '@loom-studio/shared/loom-scripts'
import type { JsonValue } from '@loom-studio/shared'
import { parseExtensionManifest } from '@loom-studio/extension-host'
import { extensionInstallationId, installedExtensionContributionId } from '@loom-studio/extension-sdk'
import { zipSync } from 'fflate'
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
    const root = posix.dirname(posix.normalize(manifestPath))
    const replacements = new Map<string, Uint8Array>()
    let changed = false
    let totalBytes = Object.values(files).reduce((sum, bytes) => sum + bytes.byteLength, 0)
    function replaceEntry(path: string, bytes: Uint8Array): void {
      const previous = replacements.get(path)
      if (previous && !Buffer.from(previous).equals(bytes)) throw new Error(`Extension Script contributions have conflicting saved content for: ${path}`)
      replacements.set(path, bytes)
      if (!Buffer.from(files[path]!).equals(bytes)) {
        totalBytes += bytes.byteLength - files[path]!.byteLength
        if (totalBytes > maxPackageBytes) throw new Error('Extension Package exceeds the local install size limit')
        files[path] = bytes
        changed = true
      }
    }
    for (const contribution of manifest.contributes?.loomScripts ?? []) {
      const relative = posix.normalize(contribution.source)
      if (relative === '..' || relative.startsWith('../') || contribution.source.includes('\\')) throw new Error(`Extension Script path escapes its package: ${contribution.source}`)
      const path = paths.get(posix.join(root, relative))
      if (!path || path.endsWith('/')) throw new Error(`Extension Script archive entry is missing: ${contribution.source}`)
      const scriptId = installedExtensionContributionId(input.packageId, installed.target, `${input.packageId}/script/${contribution.id}`)
      const document = await options.documents.get(scriptId)
      if (!document || document.type !== applicationDocumentTypes.loomScript) throw new Error(`Installed Extension Script is missing: ${scriptId}`)
      const script = document.content as LoomScriptContent
      if (script.owner.kind !== 'extension' || script.owner.packageId !== input.packageId || script.owner.installationId !== input.installationId) {
        throw new Error(`Installed Extension Script owner does not match its archive: ${scriptId}`)
      }
      const bytes = await options.blobs.read(script.source.blobId, { maxBytes: maxPackageBytes })
      replaceEntry(path, bytes)
    }
    if (manifest.contributes?.transformRules?.length) {
      async function listDocuments<T extends JsonValue>(type: string): Promise<Array<DocumentRecord<T>>> {
        const records: Array<DocumentRecord<T>> = []
        let cursor: string | undefined
        do {
          const page = await options.documents.list({ type, cursor, limit: 100 })
          records.push(...page.items as Array<DocumentRecord<T>>)
          cursor = page.nextCursor
        } while (cursor)
        return records
      }
      const [scripts, mounts] = await Promise.all([
        listDocuments<LoomScriptContent>(applicationDocumentTypes.loomScript),
        listDocuments<LoomScriptMountContent>(applicationDocumentTypes.loomScriptMount),
      ])
      for (const contribution of manifest.contributes.transformRules) {
        const candidates = scripts.filter(document => document.content.owner.kind === 'extension'
          && document.content.owner.installationId === input.installationId
          && document.content.textResourceOrigin?.contributionId === contribution.id)
        if (candidates.length !== 1) throw new Error(`Installed text-rule Script is missing or ambiguous: ${contribution.id}`)
        const document = candidates[0]!
        const script = document.content
        const bytes = await options.blobs.read(script.source.blobId, { maxBytes: maxPackageBytes })
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        const metadata = parseLoomScriptSource(source)
        const primaryContributionId = Object.keys(script.textResourceIds ?? {}).find(id => metadata.contributions.some(item => item.kind === 'text-transform' && item.id === id))
        if (!primaryContributionId) throw new Error(`Packaged primary text rule was removed from Script: ${contribution.id}`)
        const mount = mounts.find(item => item.content.scriptDocumentId === document.id
          && item.content.origin.legacyRuleId === script.textResourceIds![primaryContributionId])
        const relative = posix.normalize(contribution.source)
        if (relative === '..' || relative.startsWith('../') || contribution.source.includes('\\')) throw new Error(`Extension text rule path escapes its package: ${contribution.source}`)
        const path = paths.get(posix.join(root, relative))
        if (!path || path.endsWith('/')) throw new Error(`Extension text rule archive entry is missing: ${contribution.source}`)
        // The existing manifest slot keeps its address; the complete source is authoritative on reimport.
        const artifact = { format: 'loom.script', schemaVersion: 1, fileName: script.source.fileName, source, primaryContributionId,
          ...(mount ? { enabled: mount.content.enabled, orderIndex: mount.content.orderIndex } : {}),
          ...(mount?.content.settings ? { settings: mount.content.settings } : {}),
        }
        replaceEntry(path, new TextEncoder().encode(JSON.stringify(artifact, null, 2)))
      }
    }
    if (!changed) return input.archive
    // Stable ZIP timestamps keep repeated exports and directory snapshots identical.
    const archive = zipSync(files, { mtime: new Date(1980, 0, 1) })
    if (archive.byteLength > maxPackageBytes) throw new Error('Extension Package exceeds the local install size limit')
    return archive
  }
}
