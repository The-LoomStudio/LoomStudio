import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

describe('application runtime turn and branch integration', () => {
  it('runs createSession -> submitTurn -> timeline/run inspection without UI or a real provider', async () => {
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })

    const { session, branch } = await runtime.createSession({
      cardSourceVersionId: 'card-version-1',
      cardSnapshot: { name: 'Runtime Flow Card' },
      title: 'Runtime Flow Session',
    })
    const turn = await runtime.submitTurn({
      sessionId: session.id,
      input: '我推开门走进旧图书馆。',
    })
    const timeline = await runtime.getTimeline({ sessionId: session.id })
    const run = await runtime.getRun({ runId: turn.run.id })

    expect(session.activeBranchId).toBe(branch.id)
    expect(turn.run.status).toBe('completed')
    expect(turn.run.checkpointEntryId).toBeUndefined()
    expect(turn.branch.headEntryId).toBe(turn.entries.assistant.id)
    expect(turn.entries.user).toMatchObject({
      role: 'user',
      content: '我推开门走进旧图书馆。',
      status: 'accepted',
    })
    expect(turn.entries.assistant).toMatchObject({
      role: 'assistant',
      content: 'Agent draft: 我推开门走进旧图书馆。',
      status: 'accepted',
    })
    expect(timeline.entries.map(entry => entry.role)).toEqual(['user', 'assistant'])
    expect(run.runtimeEntries.map(entry => entry.kind)).toEqual(['user_input', 'prompt', 'provider_result'])
    expect(run.commitCandidates[0]).toMatchObject({
      status: 'auto_accepted',
      acceptedEntryId: turn.entries.assistant.id,
    })
  })

  it('forks a branch from an accepted narrative entry and keeps later turns isolated', async () => {
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })

    const { session } = await runtime.createSession({
      cardSourceVersionId: 'card-version-1',
      cardSnapshot: { name: 'Branch Card' },
    })
    const firstTurn = await runtime.submitTurn({
      sessionId: session.id,
      input: '第一条主线。',
    })
    const fork = await runtime.forkBranch({
      sessionId: session.id,
      fromEntryId: firstTurn.entries.user.id,
      title: 'Alternative',
    })
    const forkTurn = await runtime.submitTurn({
      sessionId: session.id,
      branchId: fork.branch.id,
      input: '这是分支里的改写。',
      intent: 'rewrite',
    })
    const originalTimeline = await runtime.getTimeline({
      sessionId: session.id,
      branchId: firstTurn.branch.id,
    })
    const forkTimeline = await runtime.getTimeline({
      sessionId: session.id,
      branchId: fork.branch.id,
    })

    expect(fork.branch).toMatchObject({
      forkedFromEntryId: firstTurn.entries.user.id,
      headEntryId: firstTurn.entries.user.id,
    })
    expect(forkTurn.run.checkpointEntryId).toBe(firstTurn.entries.user.id)
    expect(originalTimeline.entries.map(entry => entry.content)).toEqual([
      '第一条主线。',
      'Agent draft: 第一条主线。',
    ])
    expect(forkTimeline.entries.map(entry => entry.content)).toEqual([
      '第一条主线。',
      '这是分支里的改写。',
      'Agent draft: 这是分支里的改写。',
    ])
  })

  it('uses opening chat entries as the first branch path and allows forks from them', async () => {
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const card = await runtime.createCard({
      name: 'Opening Branch Card',
      opening: {
        entries: [
          { role: 'assistant', content: '开场：雨敲在窗上。' },
        ],
      },
    })
    const { session, branch } = await runtime.createSessionFromCard({ cardId: card.card.id })
    const mainTurn = await runtime.submitTurn({
      sessionId: session.id,
      input: '我走向柜台。',
    })
    const openingTimeline = await runtime.getTimeline({
      sessionId: session.id,
      branchId: branch.id,
    })
    const fork = await runtime.forkBranch({
      sessionId: session.id,
      fromEntryId: openingTimeline.entries[0]?.id ?? null,
      title: 'Opening Fork',
    })
    const forkTurn = await runtime.submitTurn({
      sessionId: session.id,
      branchId: fork.branch.id,
      input: '我先检查门口。',
    })
    const mainTimeline = await runtime.getTimeline({
      sessionId: session.id,
      branchId: mainTurn.branch.id,
    })
    const forkTimeline = await runtime.getTimeline({
      sessionId: session.id,
      branchId: forkTurn.branch.id,
    })

    expect(branch.headEntryId).toBe(openingTimeline.entries[0]?.id)
    expect(mainTimeline.entries.map(entry => entry.content)).toEqual([
      '开场：雨敲在窗上。',
      '我走向柜台。',
      'Agent draft: 我走向柜台。',
    ])
    expect(forkTimeline.entries.map(entry => entry.content)).toEqual([
      '开场：雨敲在窗上。',
      '我先检查门口。',
      'Agent draft: 我先检查门口。',
    ])
  })
  it('reads timeline entries beyond the first document-store page', async () => {
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const { session } = await runtime.createSession({
      cardSourceVersionId: 'card-version-1',
      cardSnapshot: { name: 'Long Timeline Card' },
    })

    for (let index = 0; index < 55; index += 1) {
      await runtime.submitTurn({
        sessionId: session.id,
        input: `第 ${index} 轮。`,
      })
    }

    const timeline = await runtime.getTimeline({ sessionId: session.id })

    expect(timeline.entries).toHaveLength(110)
    expect(timeline.entries[0]?.content).toBe('第 0 轮。')
    expect(timeline.entries.at(-1)?.content).toBe('Agent draft: 第 54 轮。')
  })
})
