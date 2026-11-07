import { decodeCardBundleZip } from '../codecs/card-bundle-zip.js'
import { isPng, readCardPngArchive, readPolyglotArchive } from '../codecs/card-png.js'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { ResourceDownloadService } from '../resource-downloads/service.js'
import type { createServerExtensionManager } from '../extensions/extension-manager.js'
import type { createCardTransferService } from '../codecs/card-transfer-service.js'
import { decodePromptResourceZip } from '../codecs/prompt-resource-zip.js'

export function createResourceDownloadUse(options: {
  downloads: ResourceDownloadService
  extensions: ReturnType<typeof createServerExtensionManager>
  runtime: ApplicationRuntime
  cards: ReturnType<typeof createCardTransferService>
}) {
  const prepared = new Map<string, { taskId: string; expires: number; digest: string; extensionToken?: string; cardTarget?: { id: string; version: number } }>()
  const completed = new Map<string, { kind: string; id?: string; message: string; warning?: string }>()
  const inFlight = new Set<string>()
  async function cardArchive(id: string) {
    const entry = options.downloads.readArtifact(id)
    if (entry.kind !== 'card') throw new Error('Select a Card download')
    const bytes = await readFile(entry.path)
    const archive = isPng(bytes) ? readCardPngArchive(bytes) ?? readPolyglotArchive(bytes) : bytes
    if (!archive) throw new Error('Only native Loom Card bundles support original-card updates; import this file as a separate card')
    return { bundle: await decodeCardBundleZip(archive), digest: createHash('sha256').update(bytes).digest('hex') }
  }
  const cardFingerprint = (runtimeFingerprint: string, digest: string) => createHash('sha256').update(`${runtimeFingerprint}:${digest}`).digest('hex')
  async function promptArtifact(id: string) {
    const entry = options.downloads.readArtifact(id)
    if (entry.kind !== 'preset') throw new Error('Select a Preset download')
    return decodePromptResourceZip(await readFile(entry.path))
  }
  async function trackAdopted(taskId: string, targetId?: string): Promise<string | undefined> {
    try {
      if (options.downloads.get(taskId).version) await options.downloads.track({ taskId, targetId })
    } catch (error) {
      return `资源采用已完成，但更新来源登记失败：${error instanceof Error ? error.message : String(error)}`
    }
  }
  return {
    async previewPromptUpdate(input: { id: string; resourceId: string }) {
      return options.runtime.previewPromptPackageUpdate({ resourceId: input.resourceId, artifact: await promptArtifact(input.id) })
    },
    async applyPromptUpdate(input: { id: string; resourceId: string; expectedVersion: number; fingerprint: string; keepLocal?: boolean }, clientId: string) {
      const result = await options.runtime.applyPromptPackageUpdate({ ...input, artifact: await promptArtifact(input.id) }, { clientId })
      return { ...result, warning: await trackAdopted(input.id, input.resourceId) }
    },
    async previewCardUpdate(input: { id: string; cardId: string }) {
      const { card } = await options.runtime.getCard({ cardId: input.cardId })
      const { bundle, digest } = await cardArchive(input.id)
      const preview = await options.runtime.previewCardPackageUpdate({ cardId: card.id, expectedVersion: card.version, artifact: bundle.artifact })
      return { ...preview, fingerprint: cardFingerprint(preview.fingerprint, digest) }
    },
    async applyCardUpdate(input: { id: string; cardId: string; expectedVersion: number; expectedFingerprint: string; keepPromptResourceIds?: string[]; keepCardFields?: string[]; keepMedia?: boolean }, clientId: string) {
      const { bundle, digest } = await cardArchive(input.id)
      const preview = await options.runtime.previewCardPackageUpdate({ cardId: input.cardId, expectedVersion: input.expectedVersion, artifact: bundle.artifact })
      if (cardFingerprint(preview.fingerprint, digest) !== input.expectedFingerprint) throw new Error('角色或下载包已变化，请重新读取差异')
      if (preview.blockingChanges.length) throw new Error(preview.blockingChanges.join('\n'))
      const hostPreparedMedia = input.keepMedia ? undefined : await options.cards.prepareUpdateMedia(bundle, clientId)
      const keepCardFields = input.keepCardFields as Parameters<ApplicationRuntime['applyCardPackageUpdate']>[0]['keepCardFields']
      const result = await options.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: preview.fingerprint, keepCardFields, artifact: bundle.artifact, hostPreparedMedia }, { clientId })
      return { ...result, warning: await trackAdopted(input.id, input.cardId) }
    },
    async preview(taskId: string, cardId?: string) {
      const artifact = options.downloads.readArtifact(taskId)
      const task = options.downloads.get(taskId)
      const bytes = await readFile(artifact.path)
      const cardTarget = task.dependencyTarget === 'card' ? await (async () => {
        if (!cardId) throw new Error('这是角色私有依赖，请从目标角色面板继续采用')
        const { card } = await options.runtime.getCard({ cardId })
        return { id: card.id, version: card.version }
      })() : undefined
      const extension = artifact.kind === 'extension' && !cardTarget ? await options.extensions.previewPackageZip!(bytes) : undefined
      const token = randomUUID()
      for (const [key, value] of prepared) if (value.expires < Date.now()) prepared.delete(key)
      prepared.set(token, { taskId, expires: Date.now() + 10 * 60_000, digest: createHash('sha256').update(bytes).digest('hex'), extensionToken: extension?.token, cardTarget })
      return { token, kind: artifact.kind, name: task.name, version: task.version, packages: extension?.packages ?? [], action: cardTarget ? '将扩展归档附加到当前角色；安装、资源采用与模块授权继续在该角色的扩展面板处理，不安装为全局扩展' : artifact.kind === 'extension' ? '安装扩展文件；已有贡献资源需另行审阅更新' : '导入为新的个人资源；不会覆盖已有内容' }
    },
    async commit(taskId: string, token: string, clientId: string) {
      const result = completed.get(token)
      if (result) return result
      const preview = prepared.get(token)
      if (!preview || preview.taskId !== taskId || preview.expires < Date.now()) throw new Error('Download adoption preview expired; prepare again')
      if (inFlight.has(taskId)) throw new Error('This resource is already being adopted')
      inFlight.add(taskId)
      // Consume before side effects. A failed import may have committed: do not replay automatically.
      prepared.delete(token)
      try {
        const artifact = options.downloads.readArtifact(taskId)
        const bytes = await readFile(artifact.path)
        if (createHash('sha256').update(bytes).digest('hex') !== preview.digest) throw new Error('下载包在确认后发生变化，请重新准备')
        let result: { kind: string; id?: string; message: string; warning?: string }
        if (artifact.kind === 'extension' && preview.cardTarget) {
          const task = options.downloads.get(taskId)
          if (!task.packageId || !task.version) throw new Error('扩展归档缺少已验证的身份与版本')
          const updated = await options.runtime.attachCardExtensionPackage({ cardId: preview.cardTarget.id, expectedVersion: preview.cardTarget.version,
            archive: { packageId: task.packageId, version: task.version, archiveBase64: bytes.toString('base64') } }, { clientId })
          result = { kind: artifact.kind, id: updated.card.id, message: '扩展归档已附加到角色；请在角色扩展面板继续安装或更新，尚未启用或授予权限' }
        } else if (artifact.kind === 'extension') {
          const installed = await options.extensions.commitRemoteInstall!(preview.extensionToken!)
          if (installed.failed) throw new Error(`${installed.installed.length} package(s) installed; ${installed.failed.packageId}: ${installed.failed.message}`)
          result = { kind: artifact.kind, message: '扩展文件安装完成；授权和资源采用请在扩展工作台处理' }
        } else {
          if (artifact.kind === 'preset') {
            const imported = await options.runtime.importPromptResource({ artifact: decodePromptResourceZip(bytes) }, { clientId })
            result = { kind: artifact.kind, id: imported.resource.id, message: '预设已导入' }
          } else {
            if (!options.cards.cardPng) throw new Error('Card transfer unavailable')
            const imported = await options.cards.importDownloaded(bytes, clientId)
            result = { kind: artifact.kind, id: imported.card.id, message: '角色包已导入' }
          }
        }
        completed.set(token, result)
        result.warning = await trackAdopted(taskId, result.id)
        if (result.warning) result.message += `；${result.warning}`
        return result
      } finally { inFlight.delete(taskId) }
    },
  }
}
