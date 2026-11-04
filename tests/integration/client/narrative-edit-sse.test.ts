// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { settle, fixture, hooks } from '../../support/client/narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { DataOperation } from '../../../apps/studio-client/src/shared/api/data-commit-events.js'

describe('Narrative edits across HTTP and SSE', () => {
  it.each([true, false])('keeps the edited body and Head when event delivery is delayed: %s', async delayEvent => {
    const { withStudioServer, callRpc, authenticatedFetch } = await import('../studio-server/helpers.js')
    await withStudioServer(async port => {
      type Page = Awaited<ReturnType<StudioApi['narratives']['getPage']>>
      type Edit = Awaited<ReturnType<StudioApi['narratives']['editNode']>>
      const card = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'Read/write ordering' })
      const created = await callRpc<Page>(port, 'application.createNarrativeTimeline', {
        cardId: card.card.id, openingContent: 'Original',
      })
      const stream = await authenticatedFetch(port, '/extensions/events')
      const reader = stream.body!.getReader()
      const decoder = new TextDecoder()
      let buffered = ''
      let editEvent: { payload: { changesetId: string; operations: DataOperation[] } } | undefined
      const readEditEvent = async () => {
        while (!editEvent) {
          const { value, done } = await reader.read()
          if (done) throw new Error('SSE closed before the edit commit')
          buffered += decoder.decode(value, { stream: true })
          let boundary: number
          while ((boundary = buffered.indexOf('\n\n')) >= 0) {
            const frame = buffered.slice(0, boundary)
            buffered = buffered.slice(boundary + 2)
            if (!frame.startsWith('event: data.changed\n')) continue
            const data = frame.split('\n').find(line => line.startsWith('data: '))!
            editEvent = JSON.parse(data.slice(6))
          }
        }
        return editEvent
      }
      const f = await fixture()
      f.createTimeline.mockResolvedValue(created)
      f.input.api.agentSessions.get = id => callRpc(port, 'application.getAgentSession', { agentSessionId: id })
      f.getTranscript.mockImplementation(params => callRpc(port, 'application.getAgentTranscriptPage', params))
      f.input.api.agentSessions.list = params => callRpc(port, 'application.listAgentSessions', params ?? {})
      vi.stubGlobal('EventSource', class {})
      await settle(() => f.render().createTimelineFromCard())
      await f.loadRoot()
      f.render()
      const dispose = f.unmount
      const oldReadReady = Promise.withResolvers<Page>()
      const releaseOldRead = Promise.withResolvers<void>()
      const reads: Promise<void>[] = []
      let holdRead = true
      let editResult: Edit | undefined
      f.input.runAction = async action => {
        const pending = action()
        reads.push(pending)
        await pending
        return true
      }
      f.getPage.mockImplementation(async params => {
        const page = await callRpc<Page>(port, 'application.getNarrativePage', params)
        if (holdRead) {
          holdRead = false
          oldReadReady.resolve(page)
          await releaseOldRead.promise
        }
        return page
      })
      f.input.api.narratives.editNode = async params => {
        const result = await callRpc<Edit>(port, 'application.editNarrativeNode', params)
        editResult = result
        if (!delayEvent) hooks.onCommit?.((await readEditEvent()).payload.operations)
        return result
      }
      try {
        hooks.narrativeConnected?.()
        const oldPage = await oldReadReady.promise
        expect(oldPage.nodes[0]?.body.raw).toBe('Original')
        await settle(() => f.render().editNarrativeNode(created.nodes[0]!.id, 'Edited'))
        const editedHead = f.render().branch?.headNodeId
        expect(editedHead).not.toBe(oldPage.branch.headNodeId)
        expect(f.render().nodes[0]?.body.raw).toBe('Edited')
        const actualEvent = await readEditEvent()
        expect(actualEvent.payload.changesetId).toBe(editResult?.mutation.changesetId)
        expect(actualEvent.payload.operations).toContainEqual(expect.objectContaining({
          entityType: 'narrative.branch', entityId: created.branch.id, kind: 'update',
        }))
        releaseOldRead.resolve()
        await Promise.all(reads)
        expect(f.render().nodes[0]?.body.raw).toBe('Edited')
        expect(f.render().branch?.headNodeId).toBe(editedHead)
        if (delayEvent) hooks.onCommit?.(actualEvent.payload.operations)
        await Promise.all(reads)
        expect(f.render().nodes[0]?.body.raw).toBe('Edited')
        expect(f.reportFailure).not.toHaveBeenCalled()
      } finally {
        releaseOldRead.resolve()
        dispose?.()
        await reader.cancel()
      }
    })
  })
})
