import { parseLoomScriptSource, resolveLoomScriptSettings, resolveTextTransformContributionRule } from '@loom-studio/shared/loom-scripts'
import type { LoomScript, LoomScriptMount, LoomScriptOwner } from '../entities/index.js'
import type { StudioApi } from '../shared/api/studio-api.js'

type ManagementApi = Pick<StudioApi['loomScripts'], 'list' | 'listMounts' | 'export' | 'import' | 'update' | 'createMount' | 'updateMount' | 'refreshMount'>

// In-memory authoring preview. Never executes source or calls the application API.
export function createScriptManagementPreviewApi(scene: 'normal' | 'empty' | 'many' = 'normal'): ManagementApi {
  const now = '2026-10-24T00:00:00Z'
  const mutation = { changesetId: 'preview' }
  const sources = new Map<string, string>()
  function script(id: string, name: string, owner: LoomScriptOwner): LoomScript {
    const source = `// ==LoomScript==\n// @format 1\n// @id ${id}\n// @name ${name}\n// @version 1.0.0\n// @runtime client\n// ==/LoomScript==\n\nexport function activate(ctx) {\n  ctx.logger.info('示例脚本已启动')\n}\n`
    sources.set(id, source)
    return { id, name, owner, version: 2, formatVersion: 1, metadataId: id, scriptVersion: '1.0.0', runtime: 'client',
      requestedCapabilities: ['runtime.client'], contributions: [], sourceDigest: 'preview',
      source: { blobId: id, fileName: `${id}.loom.js`, mediaType: 'text/javascript' }, createdAt: now, updatedAt: now }
  }
  const scripts = scene === 'empty' ? [] : [script('scene-card', '场景背景卡', { kind: 'card', cardId: 'preview-card' }),
    script('status', 'Alice Character Status', { kind: 'extension', packageId: 'example.status', installationId: 'preview' })]
  if (scene === 'many') for (let i = 0; i < 30; i++) scripts.push(script(`helper-${i}`, `角色创作辅助脚本 ${i + 1} · 较长名称展示`, { kind: 'user' }))
  const mounts: LoomScriptMount[] = scene === 'empty' ? [] : [
    { id: 'global', version: 1, scriptDocumentId: 'scene-card', target: { kind: 'user' }, enabled: false, runtimeRevision: 0, orderIndex: 0, grantedCapabilities: [], origin: {}, createdAt: now, updatedAt: now },
    { id: 'role', version: 1, scriptDocumentId: 'scene-card', target: { kind: 'card', cardId: 'preview-card' }, enabled: true, orderIndex: 0, grantedCapabilities: ['runtime.client'], adoptedDocumentVersion: 2, adoptedSettings: {}, runtimeRevision: 1, origin: {}, createdAt: now, updatedAt: now },
  ]
  function findScript(id: string) { const value = scripts.find(item => item.id === id); if (!value) throw new Error('示例脚本不存在'); return value }
  function findMount(id: string, version: number) { const value = mounts.find(item => item.id === id); if (!value || value.version !== version) throw new Error('示例采用版本冲突'); return value }
  const api: ManagementApi = {
    list: async () => ({ scripts: structuredClone(scripts) }),
    listMounts: async () => ({ mounts: structuredClone(mounts) }),
    export: async id => ({ artifact: { format: 'loom.script', schemaVersion: 1, fileName: findScript(id).source.fileName, source: sources.get(id)! } }),
    import: async input => {
      const value = script(crypto.randomUUID(), input.source.match(/^\/\/ @name (.+)$/m)?.[1] ?? '新脚本', input.owner)
      value.source.fileName = input.fileName
      value.version = 1
      sources.set(value.id, input.source)
      scripts.push(value)
      if (input.mount) {
        const metadata = input.fileName.endsWith('.md') ? parseLoomScriptSource(input.source) : undefined
        const rule = metadata?.contributions.find(item => item.kind === 'text-transform')
        mounts.push({ id: crypto.randomUUID(), version: 1, scriptDocumentId: value.id,
          target: structuredClone(input.mount.target), enabled: false,
          orderIndex: input.mount.orderIndex ?? (rule?.kind === 'text-transform' ? resolveTextTransformContributionRule(rule, resolveLoomScriptSettings(metadata?.settings)).orderIndex : undefined) ?? 0,
          grantedCapabilities: [], settings: {}, runtimeRevision: 0, origin: {}, createdAt: now, updatedAt: now })
      }
      return { script: structuredClone(value), mutation }
    },
    update: async input => {
      const value = findScript(input.scriptDocumentId)
      if (value.version !== input.expectedVersion) throw new Error('示例脚本版本冲突')
      value.version++
      value.source.fileName = input.fileName
      sources.set(value.id, input.source)
      return { script: structuredClone(value), mutation }
    },
    createMount: async input => {
      const mount: LoomScriptMount = { ...input, id: crypto.randomUUID(), version: 1, enabled: false, runtimeRevision: 0, grantedCapabilities: [], origin: {}, createdAt: now, updatedAt: now }
      mounts.push(mount)
      return { mount: structuredClone(mount), mutation }
    },
    updateMount: async input => {
      const mount = findMount(input.mountId, input.expectedVersion)
      const activating = input.enabled && !mount.enabled
      if (input.enabled !== mount.enabled) mount.runtimeRevision++
      Object.assign(mount, { enabled: input.enabled, grantedCapabilities: [...input.grantedCapabilities], version: mount.version + 1 })
      if (activating) {
        mount.adoptedDocumentVersion = input.pinnedDocumentVersion ?? mount.pinnedDocumentVersion ?? findScript(mount.scriptDocumentId).version
        mount.adoptedSettings = {}
      }
      return { mount: structuredClone(mount), mutation }
    },
    refreshMount: async input => {
      const mount = findMount(input.mountId, input.expectedVersion)
      mount.version++
      mount.adoptedDocumentVersion = mount.pinnedDocumentVersion ?? findScript(mount.scriptDocumentId).version
      mount.adoptedSettings = {}
      mount.runtimeRevision++
      return { mount: structuredClone(mount), mutation }
    },
  }
  return api
}
