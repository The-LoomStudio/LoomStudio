import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { describe, expect, it } from 'vitest'

describe('Studio Client logging coverage', () => {
  it('captures theme events in client memory sink', async () => {
    const memory = createMemoryLogSink({ capacity: 50 })
    const root = createRootLogger({
      service: 'studio-client',
      instanceId: 'test-client',
      sinks: [memory],
    })
    const themeLogger = root.child('theme')

    themeLogger.info('Theme applied · dark', {
      event: 'theme.applied',
      data: { theme: 'dark', enhancementCount: 2 },
    })
    themeLogger.info('Theme reset to default', {
      event: 'theme.reset',
    })
    themeLogger.error('Theme application failed', {
      event: 'theme.failed',
      error: { message: 'Invalid CSS layer' },
    })

    const events = memory.list().map(r => r.event)
    expect(events).toEqual(['theme.applied', 'theme.reset', 'theme.failed'])
    expect(memory.list().every(r => r.service === 'studio-client')).toBe(true)
    expect(memory.list().every(r => r.namespace === 'theme')).toBe(true)
  })

  it('captures client runtime narrative events in client memory sink', async () => {
    const memory = createMemoryLogSink({ capacity: 50 })
    const root = createRootLogger({
      service: 'studio-client',
      instanceId: 'test-client',
      sinks: [memory],
    })
    const runtimeLogger = root.child('runtime.client')

    runtimeLogger.info('Agent run started', {
      event: 'agent.run.started',
      data: { runId: 'run-123', sessionId: 'session-456' },
    })
    runtimeLogger.info('Agent run cancelled by user', {
      event: 'agent.run.cancelled',
      data: { runId: 'run-123' },
    })
    runtimeLogger.info('Agent session deleted · session-456', {
      event: 'agent.session.deleted',
      data: { sessionId: 'session-456' },
    })
    runtimeLogger.info('Narrative timeline deleted · timeline-789', {
      event: 'narrative.timeline.deleted',
      data: { timelineId: 'timeline-789' },
    })

    const records = memory.list()
    expect(records.map(r => r.event)).toEqual([
      'agent.run.started',
      'agent.run.cancelled',
      'agent.session.deleted',
      'narrative.timeline.deleted',
    ])
    expect(records[0]?.data).toMatchObject({ runId: 'run-123', sessionId: 'session-456' })
    expect(records.every(r => r.namespace === 'runtime.client')).toBe(true)
  })
})
