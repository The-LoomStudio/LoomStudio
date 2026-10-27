import { describe, expect, it } from 'vitest'
import { authenticatedFetch, callRpc, withStudioServer } from '../../integration/studio-server/helpers.js'

describe('tRPC wire contract', () => {
  it.each(['single', 'batch'])('preserves %s editing CAS and domain failure tracing without exposing stacks', async mode => {
    await withStudioServer(async port => {
      const { resource } = await callRpc<{ resource: { id: string; version: number; rootNode: { id: string; label: string } } }>(port, 'application.createPromptResource', { resourceKind: 'lore', name: 'Original' })
      const { resource: latest } = await callRpc<{ resource: typeof resource }>(port, 'application.updatePromptResourceAsset', {
        resourceId: resource.id, assetId: resource.rootNode.id, expectedVersion: resource.version, label: 'Agent edit',
      })
      const method = mode === 'single' ? 'application.updatePromptResourceAsset' : 'application.updatePromptResourceAssets'
      const submit = (expectedVersion: number) => authenticatedFetch(port, `/trpc/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'contract-correlation' },
        body: JSON.stringify({ resourceId: resource.id, expectedVersion, ...(mode === 'single'
          ? { assetId: resource.rootNode.id, label: 'User edit' }
          : { updates: [{ assetId: resource.rootNode.id, label: 'User edit' }] }) }),
      })
      const response = await submit(resource.version)
      const payload = await response.json()
      expect(response.status).toBe(409)
      expect(payload.error.data).toMatchObject({ domainCode: 'prompt_resource.conflict', correlationId: 'contract-correlation', callId: response.headers.get('x-call-id') })
      expect(payload.error.data.stack).toBeUndefined()
      const unchanged = await callRpc<{ resource: typeof resource }>(port, 'application.getPromptResource', { resourceId: resource.id })
      expect(unchanged.resource).toEqual(latest)
      const invalid = await submit(0)
      expect(invalid.ok).toBe(false)
      expect((await invalid.json()).error.data.domainCode).toBe('prompt_resource.expected_version_invalid')
      const saved = await submit(latest.version)
      expect(saved.status).toBe(200)
      expect((await saved.json()).result.data.resource).toMatchObject({ version: latest.version + 1, rootNode: { label: 'User edit' } })
    })
  })

  it('rejects unknown timeline arguments and exposes actionable artifact and range errors', async () => {
    await withStudioServer(async port => {
      const post = (method: string, input: unknown) => authenticatedFetch(port, `/trpc/application.${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      })
      const { card } = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'Probe', opening: 'Opening' })
      const unknown = await post('createNarrativeTimeline', { cardId: card.id, openingNodes: [{ content: 'History' }], nonsenseParam: 123 })
      expect(unknown.status).toBe(400)
      expect((await unknown.json()).error.message).toContain('openingNodes')
      const invalidArtifact = await post('importCardBundle', { artifact: { schemaVersion: 3 } })
      expect(invalidArtifact.status).toBe(400)
      expect((await invalidArtifact.json()).error.message).toContain('Unsupported card bundle schemaVersion: 3')
      const range = await post('listNarrativeTimelines', { limit: 200 })
      expect(range.status).toBe(400)
      expect((await range.json()).error.data.domainCode).toBe('narrative.timeline_list_limit_invalid')
    })
  })

  it('does not allow the dynamic extension gateway to bypass static procedures', async () => {
    await withStudioServer(async port => {
      await expect(callRpc(port, 'kernel.invoke', { method: 'application.createCard', params: { name: 'Bypass' } })).rejects.toThrow('typed platform procedure')
      expect(await callRpc(port, 'application.listCards', {})).toMatchObject({ cards: [] })
      expect((await authenticatedFetch(port, '/rpc', { method: 'POST' })).status).toBe(404)
    })
  })
})
