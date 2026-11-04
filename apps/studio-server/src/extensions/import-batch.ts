import { z } from 'zod'
import { assertCardBundleArtifact, isPromptResourceArtifact } from '@loom-studio/application-runtime/artifacts'
import type { ApplicationRuntime, RuntimeRequestContext, ExtensionInstallationTarget } from '@loom-studio/application-runtime'
import type { AssetStore } from '@loom-studio/asset-store'
import type { Kernel } from '@loom-studio/kernel'

// Importers yield native Loom data. Foreign file formats stay in their extension.
const key = z.string().min(1)
const itemSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('prompt-resource'), key, artifact: z.unknown() }),
  z.strictObject({ kind: z.literal('card'), key, artifact: z.unknown(), avatarBase64: z.string().optional(), promptResourceKeys: z.array(key).optional() }),
  z.strictObject({ kind: z.literal('history'), key, cardKey: key, title: z.string(), messages: z.array(z.strictObject({
    content: z.string(), createdAt: z.iso.datetime({ offset: true }).optional(),
  })) }),
  z.strictObject({ kind: z.literal('skipped'), key, reason: z.string() }),
]).nullable()

export function createExtensionBatchImporter(input: {
  kernel: Pick<Kernel, 'callRpc'>
  runtime: ApplicationRuntime
  assets?: AssetStore
  saveImportedCard(id: string): Promise<void>
}) {
  const active = new Set<string>()
  return {
    async commit(source: { packageId: string; target: ExtensionInstallationTarget; sessionId: string }, context: RuntimeRequestContext) {
      const identity = JSON.stringify([source.packageId, source.target, source.sessionId])
      if (active.has(identity)) throw new Error('This import is already running')
      active.add(identity)
      const report = { imported: 0, skipped: [] as Array<{ key: string; reason: string }> }
      const cards = new Map<string, string>()
      const resources = new Map<string, string>()
      const keys = new Set<string>()
      const call = (action: 'prepare' | 'cancel', params: { sessionId: string; index?: number }) => input.kernel.callRpc('extensions.callPackageRpc', {
        packageId: source.packageId, target: source.target,
        method: `${source.packageId}.migration.${action}`, params,
      }, context)
      let failure: unknown
      let currentKey: string | undefined
      try {
        for (let index = 0; index <= 20_000; index += 1) {
          context.abortSignal?.throwIfAborted()
          currentKey = undefined
          const item = itemSchema.parse(await call('prepare', { sessionId: source.sessionId, index }))
          if (item === null) return report
          if (index === 20_000) throw new Error('Import exceeds 20000 items')
          if (keys.has(item.key)) throw new Error(`Duplicate import key: ${item.key}`)
          currentKey = item.key
          keys.add(item.key)
          if (item.kind === 'skipped') {
            report.skipped.push({ key: item.key, reason: item.reason })
            continue
          }
          if (item.kind === 'prompt-resource') {
            if (!isPromptResourceArtifact(item.artifact)) throw new Error(`Invalid native Prompt Resource artifact: ${item.key}`)
            const created = await input.runtime.importPromptResource({ artifact: item.artifact }, context)
            resources.set(item.key, created.resource.id)
          } else if (item.kind === 'card') {
            assertCardBundleArtifact(item.artifact)
            const sharedIds = (item.promptResourceKeys ?? []).map(resourceKey => {
              const id = resources.get(resourceKey)
              if (!id) throw new Error(`Import resource must precede its Card: ${resourceKey}`)
              return id
            })
            if (item.avatarBase64 !== undefined) {
              if (!input.assets) throw new Error('Asset storage is unavailable')
              const bytes = Buffer.from(item.avatarBase64, 'base64')
              if (bytes.toString('base64') !== item.avatarBase64) throw new Error(`Invalid avatar encoding: ${item.key}`)
              const { asset } = await input.assets.createMediaAsset({
                source: bytes, kind: 'card.avatar', mediaType: 'image/png', maxBytes: 32 * 1024 * 1024,
                actor: context.actor ?? { kind: 'client', id: context.clientId! }, reason: 'application.importConvertedBatch.media',
              })
              item.artifact.card.media = { ...item.artifact.card.media, avatarAssetId: asset.id }
            }
            const created = await input.runtime.importCardBundle({ artifact: item.artifact }, context)
            // Count the persisted Card even if a subsequent binding or directory save fails.
            report.imported += 1
            if (sharedIds.length) await input.runtime.updateCardPromptResources({
              cardId: created.card.id,
              expectedVersion: created.card.version,
              promptResourceIds: [...new Set([...(created.card.promptResourceIds ?? []), ...sharedIds])],
              externalPromptResourceIds: sharedIds,
            }, context)
            await input.saveImportedCard(created.card.id)
            cards.set(item.key, created.card.id)
            continue
          } else {
            const cardId = cards.get(item.cardKey)
            if (!cardId) throw new Error(`Import Card must precede its history: ${item.cardKey}`)
            await input.runtime.importNarrativeHistory({ cardId, title: item.title, messages: item.messages }, context)
          }
          report.imported += 1
        }
        throw new Error('Import did not terminate')
      } catch (error) {
        failure = error
        throw new Error(`迁移中止，已有 ${report.imported} 项写入。${currentKey ? `当前文件：${currentKey}。` : ''}请勿直接重复导入同一批数据。${error instanceof Error ? error.message : String(error)}`, { cause: error })
      } finally {
        // Consume the staging session on failure too: a retry must not repeat accepted writes.
        try { await call('cancel', { sessionId: source.sessionId }) }
        catch (error) {
          // eslint-disable-next-line no-unsafe-finally -- Report cleanup failure only when no primary import failure exists.
          if (!failure) throw new Error(`已导入 ${report.imported} 项，但临时文件清理失败；请勿重复迁移。${error instanceof Error ? error.message : String(error)}`, { cause: error })
        } finally { active.delete(identity) }
      }
    },
  }
}
