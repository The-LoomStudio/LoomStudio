import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withStudioServer, callRpc } from './helpers.js'

describe('bundled Story Memory through the real extension host', () => {
  it('installs and activates the package, gates Timeline RPCs by adoption, and reads fixed sources without a configured model', async () => {
    await withStudioServer(async port => {
      const packageId = 'official.story-memory'
      await callRpc(port, 'extensions.installPackage', { sourceDirectory: resolve('official/extensions/story-memory') })
      for (const moduleId of ['server', 'client']) await callRpc(port, 'extensions.enableModule', { packageId, moduleId })
      const resources = await callRpc<{ resources: Array<{ id: string; resourceKind: string; origin?: { packageId: string; contributionId: string } }> }>(
        port, 'application.listPromptResources', { resourceKind: 'preset' })
      const preset = resources.resources.find(item => item.origin?.packageId === packageId)
      expect(preset).toMatchObject({ resourceKind: 'preset', origin: { contributionId: 'official.story-memory.summary' } })
      const installations = await callRpc<{ installations: Array<{ id: string; packageId: string }> }>(port, 'application.listExtensionInstallations', {})
      const installationId = installations.installations.find(item => item.packageId === packageId)!.id
      const { card } = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'Host memory' })
      const story = await callRpc<{ timeline: { id: string }; branch: { id: string; headNodeId?: string } }>(port, 'application.createNarrativeTimeline', { cardId: card.id })
      const target = { timelineId: story.timeline.id, branchId: story.branch.id }
      const invoke = <T>(method: string, args = {}) => callRpc<T>(port, 'extensions.invoke', { packageId, target: { kind: 'global' }, method: `${packageId}.${method}`, params: { ...target, ...args } })
      await expect(invoke('status')).rejects.toThrow('not active in this Timeline')
      const preview = await callRpc(port, 'application.previewTimelineExtensionAdoption', { ...target, installationId })
      await callRpc(port, 'application.adoptTimelineExtension', preview)
      const initial = await invoke<{ policyVersion: number | null; batches: unknown[]; policy: { enabled: boolean } }>('status')
      expect(initial.batches).toEqual([])
      expect(initial.policy.enabled).toBe(true)
      await invoke('configure', { value: { enabled: false, batchFloors: 2, bufferFloors: 0 }, expectedVersion: initial.policyVersion })
      expect((await invoke<{ policy: { enabled: boolean } }>('status')).policy.enabled).toBe(false)
      let head = story.branch.headNodeId ?? null
      for (const [index, content] of ['首楼证据', '第二楼证据', '后续缓冲'].entries()) {
        const result = await callRpc<{ node: { id: string } }>(port, 'application.appendNarrativeInput', {
          ...target, nodeId: `memory-host-${index}`, content, expectedHeadNodeId: head,
        })
        head = result.node.id
      }
      await invoke('prepare', { level: 1 })
      const status = await invoke<{ batches: Array<{ id: string; status: string; resident: boolean; error: string }> }>('status')
      expect(status.batches).toHaveLength(1)
      expect(status.batches[0]).toMatchObject({ status: 'failed', resident: false })
      expect(status.batches[0]!.error).toContain('no model binding')
      const source = await invoke<{ text: string }>('source', { id: status.batches[0]!.id })
      expect(source.text).toContain('首楼证据')
      expect(source.text).toContain('第二楼证据')
      expect(source.text).not.toContain('后续缓冲')
    })
  })
})
