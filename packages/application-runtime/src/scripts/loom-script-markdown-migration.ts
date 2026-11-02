import { parseDocument } from 'yaml'
import type { DocumentRecord, SqliteDocumentStore } from '@loom-studio/document-store'
import { serializeMarkdownTextRule, resolveTextTransformContributionRule } from '@loom-studio/shared/loom-scripts'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, writeDocument } from '../foundation/document-store.js'
import { parseLoomScriptSource } from './loom-script-codec.js'
import type { LoomScriptContent, LoomScriptMountContent } from './loom-script-contracts.js'

type Context = Pick<ApplicationRuntimeContext, 'documents' | 'blobs' | 'dataEngine' | 'now'>

function convert(script: LoomScriptContent, original: string): string | undefined {
  const contribution = script.contributions[0]
  // Only the former one-rule import format is eligible. Never discard author code,
  // settings, dependencies, extra contributions or renamed contribution addresses.
  if (script.runtime !== 'declarative' || script.contributions.length !== 1
    || contribution?.kind !== 'text-transform' || contribution.id !== 'rule' || contribution.requiresCode
    || script.settings?.length || script.requires?.length || script.requestedCapabilities.length
    || !/^\s*\/\/ ==LoomScript==[\s\S]*\/\/ ==\/LoomScript==\s*$/.test(original)) return
  const rule = resolveTextTransformContributionRule(contribution, {})
  if (rule.name !== script.name || (rule.phases.includes('classify') && rule.phases.length > 1)) return
  const serialized = serializeMarkdownTextRule(rule, script.metadataId)
  const end = serialized.indexOf('\n---\n', 4)
  const header = parseDocument(serialized.slice(4, end))
  header.set('version', script.scriptVersion)
  if (script.tags?.length) header.set('tags', script.tags)
  return `---\n${header.toString({ lineWidth: 0 })}---\n${serialized.slice(end + 5)}`
}

/** Converts latest and adopted/pinned revisions together; old revisions remain recoverable. */
export async function migrateLegacyRuleScriptsToMarkdown(ctx: Context) {
  const report: { migrated: string[]; skipped: Array<{ id: string; reason: string }> } = { migrated: [], skipped: [] }
  const scripts = await listDocuments<LoomScriptContent>(ctx.documents, applicationDocumentTypes.loomScript)
  for (const script of scripts) {
    if (script.content.source.fileName.endsWith('.md') || !script.content.textResourceIds) continue
    if (!ctx.blobs) throw new Error('Blob Store is required to migrate rule Scripts')
    if (!('participateTransaction' in ctx.documents)) throw new Error('SQLite Document Store is required to migrate rule Scripts atomically')
    const documents = ctx.documents as SqliteDocumentStore
    const mounts = (await listDocuments<LoomScriptMountContent>(documents, applicationDocumentTypes.loomScriptMount))
      .filter(mount => mount.content.scriptDocumentId === script.id)
    const versions = [...new Set(mounts.flatMap(mount => [mount.content.adoptedDocumentVersion, mount.content.pinnedDocumentVersion])
      .filter((version): version is number => version !== undefined && version !== script.version)), script.version]
    const prepared: Array<{ revision: DocumentRecord<LoomScriptContent>; metadata: ReturnType<typeof parseLoomScriptSource>; blob: Awaited<ReturnType<NonNullable<Context['blobs']>['prepareWrite']>> }> = []
    const unchangedVersions = new Map<number, number>()
    let unsupported = false
    for (const version of versions) {
      const revision = await documents.get(script.id, { version }) as DocumentRecord<LoomScriptContent> | null
      if (!revision) throw new Error(`Missing rule Script revision: ${script.id}@${version}`)
      if (revision.content.source.fileName.endsWith('.md')) { unchangedVersions.set(version, version); continue }
      const source = convert(revision.content, new TextDecoder('utf-8', { fatal: true }).decode(await ctx.blobs.read(revision.content.source.blobId)))
      if (source === undefined) { unsupported = true; break }
      prepared.push({ revision, metadata: parseLoomScriptSource(source), blob: await ctx.blobs.prepareWrite({ source: new TextEncoder().encode(source), mediaType: 'text/markdown' }) })
    }
    if (unsupported) {
      report.skipped.push({ id: script.id, reason: '源码或已采用版本包含代码、配置、多个贡献或无法无损转换的规则；保留原样。' })
      continue
    }
    await ctx.dataEngine.transact({ actor: { kind: 'kernel', id: 'application-runtime' }, reason: 'application.migrateRuleScriptToMarkdown' }, async tx => {
      await documents.participateTransaction(tx, async transaction => {
        const current = await transaction.get(script.id)
        if (current?.version !== script.version) throw new Error(`Script changed during migration: ${script.id}`)
        const mapped = new Map(unchangedVersions)
        let expectedVersion = script.version
        for (const item of prepared) {
          const blob = ctx.blobs!.participateWrite(tx, item.blob).blob
          const updated = await writeDocument<LoomScriptContent>(transaction, {
            id: script.id, type: applicationDocumentTypes.loomScript, expectedVersion,
            content: { ...item.revision.content, ...item.metadata,
              source: { blobId: blob.id, mediaType: 'text/markdown', fileName: item.revision.content.source.fileName.replace(/(?:\.loom)?\.js$/i, '') + '.rule.md' },
              sourceDigest: blob.sha256, updatedAt: ctx.now() },
          })
          mapped.set(item.revision.version, updated.version)
          expectedVersion = updated.version
        }
        for (const mount of mounts) {
          await writeDocument<LoomScriptMountContent>(transaction, {
            id: mount.id, type: applicationDocumentTypes.loomScriptMount, expectedVersion: mount.version,
            content: { ...mount.content,
              ...(mount.content.pinnedDocumentVersion !== undefined ? { pinnedDocumentVersion: mapped.get(mount.content.pinnedDocumentVersion)! } : {}),
              ...(mount.content.adoptedDocumentVersion !== undefined || mount.content.enabled
                ? { adoptedDocumentVersion: mapped.get(mount.content.adoptedDocumentVersion ?? mount.content.pinnedDocumentVersion ?? script.version)! } : {}),
              runtimeRevision: mount.content.runtimeRevision ?? mount.version, updatedAt: ctx.now() },
          })
        }
      })
    })
    report.migrated.push(script.id)
  }
  return report
}
