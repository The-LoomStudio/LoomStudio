import { applicationDocumentTypes, createApplicationRuntime } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

describe('application runtime card and session integration', () => {
  it('creates a fake card JSON and initializes a session from its frozen snapshot', async () => {
    const capturedPrompts: Array<Array<{ role: string; content: string }>> = []
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
      provider: {
        invoke: async input => {
          capturedPrompts.push(input.messages)
          return {
            provider: 'fake',
            model: 'fake-card-test',
            content: 'Agent draft from card snapshot',
          }
        },
      },
    })

    const created = await runtime.createCard({
      name: '雾港旅馆',
      description: '一张用于测试的 AIRP 假卡。',
      opening: {
        entries: [
          { role: 'assistant', content: '雨夜，玩家推开旅馆的门。' },
        ],
      },
      settingLayer: {
        entries: [
          {
            path: 'world.location.fog-harbor',
            title: '雾港',
            content: '雾港潮湿而安静。',
            activation: { kind: 'always' },
          },
        ],
      },
    })
    const listed = await runtime.listCards()
    const session = await runtime.createSessionFromCard({
      cardId: created.card.id,
    })
    await runtime.submitTurn({
      sessionId: session.session.id,
      input: '我看向柜台后的铃铛。',
    })

    expect(created.card).toMatchObject({
      name: '雾港旅馆',
      opening: { entries: [{ role: 'assistant', content: '雨夜，玩家推开旅馆的门。' }] },
      settingLayer: { entries: [expect.objectContaining({ title: '雾港', content: '雾港潮湿而安静。' })] },
    })
    expect(listed.cards.map(card => card.id)).toContain(created.card.id)
    expect(session.session).toMatchObject({
      cardSourceVersionId: `${created.card.id}@${created.card.version}`,
      title: '雾港旅馆',
    })
    expect(session.session.cardSnapshot).toMatchObject({
      id: created.card.id,
      version: created.card.version,
      name: '雾港旅馆',
      description: '一张用于测试的 AIRP 假卡。',
      opening: { entries: [{ role: 'assistant', content: '雨夜，玩家推开旅馆的门。' }] },
      settingLayer: { entries: [expect.objectContaining({ title: '雾港', content: '雾港潮湿而安静。' })] },
    })
    expect(capturedPrompts[0]?.[0]?.content).toContain('Card description: 一张用于测试的 AIRP 假卡。')
    expect(capturedPrompts[0]?.[0]?.content).toContain('雾港潮湿而安静。')
    expect(capturedPrompts[0]?.[1]).toMatchObject({ role: 'assistant', content: '雨夜，玩家推开旅馆的门。' })
  })

  it('normalizes legacy stored cards when reading and opening sessions', async () => {
    const documents = createInMemoryDocumentStore()
    const runtime = createApplicationRuntime({ documents })

    await documents.write({
      id: 'legacy-card',
      type: applicationDocumentTypes.cardSource,
      content: {
        name: '旧格式卡',
        description: '旧的 opening / setting 字段。',
        opening: '旧开场白。',
        setting: {
          location: '旧港',
          mood: '雨夜',
        },
      },
      expectedVersion: 'new',
    })

    const card = await runtime.getCard({ cardId: 'legacy-card' })
    const created = await runtime.createSessionFromCard({ cardId: 'legacy-card' })
    const timeline = await runtime.getTimeline({ sessionId: created.session.id })

    expect(card.card.opening).toEqual({ entries: [{ role: 'assistant', content: '旧开场白。' }] })
    expect(card.card.settingLayer.entries[0]).toMatchObject({
      id: 'legacy.setting',
      title: 'Imported Setting',
      tags: ['legacy'],
    })
    expect(timeline.entries.map(entry => entry.content)).toEqual(['旧开场白。'])
  })

  it('updates and deletes card sources without mutating existing session snapshots', async () => {
    const documents = createInMemoryDocumentStore()
    const runtime = createApplicationRuntime({
      documents,
    })
    const created = await runtime.createCard({
      name: '旧卡名',
      userName: '旧玩家',
      description: '旧简介。',
    }, {
      clientId: 'card-client',
      correlationId: 'corr-create-card',
      callId: 'call-create-card',
    })
    const session = await runtime.createSessionFromCard({ cardId: created.card.id })
    const updated = await runtime.updateCard({
      cardId: created.card.id,
      name: '新卡名',
      userName: '',
      description: '新简介。',
    }, {
      clientId: 'card-client',
      correlationId: 'corr-update-card',
      callId: 'call-update-card',
      parentCallId: 'call-create-card',
    })
    const listedBeforeDelete = await runtime.listCards()
    const deleted = await runtime.deleteCard({ cardId: created.card.id }, {
      clientId: 'card-client',
      correlationId: 'corr-delete-card',
      callId: 'call-delete-card',
      parentCallId: 'call-update-card',
    })
    const listedAfterDelete = await runtime.listCards()
    const frozen = await runtime.getSession({ sessionId: session.session.id })
    const createChangeset = await documents.getChangeset(created.mutation.changesetId)
    const updateChangeset = await documents.getChangeset(updated.mutation.changesetId)
    const deleteChangeset = await documents.getChangeset(deleted.mutation.changesetId)

    expect(updated.card).toMatchObject({
      id: created.card.id,
      name: '新卡名',
      description: '新简介。',
    })
    expect(updated.card.userName).toBeUndefined()
    expect(createChangeset).toMatchObject({
      createdBy: { kind: 'client', id: 'card-client' },
      reason: 'application.createCard',
      correlationId: 'corr-create-card',
    })
    expect(updateChangeset).toMatchObject({
      createdBy: { kind: 'client', id: 'card-client' },
      reason: 'application.updateCard',
      correlationId: 'corr-update-card',
      parentCallId: 'call-create-card',
    })
    expect(deleteChangeset).toMatchObject({
      createdBy: { kind: 'client', id: 'card-client' },
      reason: 'application.deleteCard',
      correlationId: 'corr-delete-card',
      parentCallId: 'call-update-card',
    })
    expect(listedBeforeDelete.cards).toContainEqual(expect.objectContaining({ id: created.card.id, name: '新卡名' }))
    expect(listedAfterDelete.cards.map(card => card.id)).not.toContain(created.card.id)
    expect(frozen.session.cardSnapshot).toMatchObject({
      name: '旧卡名',
      userName: '旧玩家',
      description: '旧简介。',
    })
  })
})
