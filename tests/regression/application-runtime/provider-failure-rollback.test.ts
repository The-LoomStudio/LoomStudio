import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

describe('application runtime provider failure regression', () => {
  it('does not leave partial runtime documents when provider invocation fails', async () => {
    const documents = createInMemoryDocumentStore()
    const runtime = createApplicationRuntime({
      documents,
      provider: {
        invoke: async () => {
          throw new Error('provider failed')
        },
      },
    })
    const { session } = await runtime.createSession({
      cardSourceVersionId: 'card-version-1',
      cardSnapshot: { name: 'Failure Card' },
    })

    await expect(runtime.submitTurn({
      sessionId: session.id,
      input: '这次会失败。',
    })).rejects.toThrow('provider failed')

    expect((await documents.list({ type: 'airp.run' })).items).toHaveLength(0)
    expect((await documents.list({ type: 'airp.narrativeEntry' })).items).toHaveLength(0)
    expect((await documents.list({ type: 'airp.runtimeEntry' })).items).toHaveLength(0)
  })
})
