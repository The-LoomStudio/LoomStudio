import { describe, expect, it, vi } from 'vitest'
import { primaryFixture } from '../../support/client/narrative-runtime.js'

describe('Task menu Run observation', () => {
  it('preserves cancelled input recovery when summary status refreshes the Session', async () => {
    const f = await primaryFixture()
    f.render().setAgentInput('Keep this input')
    f.subscribeRun.mockResolvedValueOnce({ events: [], nextCursor: 1, done: true, state: 'cancelled' })
    await f.render().submitAgentTurn(f.event)
    await f.loadRoot()
    await f.render().refreshTaskSession('session')
    expect(f.render().runRecovery?.input).toBe('Keep this input')
    f.render().restoreRunInput()
    expect(f.render().agentComposerInput).toBe('Keep this input')
  })

  it('observes an externally resumed Run without creating a Run or clearing either draft', async () => {
    const f = await primaryFixture()
    f.render().setAgentInput('Unsent agent draft')
    f.render().observeTaskRun('session', 'background-continuation')
    await vi.waitFor(() => expect(f.acknowledgeRunCompletion).toHaveBeenCalled())
    expect(f.subscribeRun).toHaveBeenCalledWith('background-continuation', 0, 'session')
    expect(f.createRun).not.toHaveBeenCalled()
    expect(f.appendInput).not.toHaveBeenCalled()
    expect(f.render().composerInput).toBe('  Draft\n')
    expect(f.render().agentComposerInput).toBe('Unsent agent draft')
    expect(f.getPage).toHaveBeenCalled()
  })

  it('does not attach a background Session to the visible composer', async () => {
    const f = await primaryFixture()
    f.render().observeTaskRun('another-session', 'background-run')
    await f.render().refreshTaskSession('another-session')
    expect(f.subscribeRun).not.toHaveBeenCalled()
    expect(f.getTranscript).not.toHaveBeenCalled()
    expect(f.render().agentSession?.id).toBe('session')
    expect(f.render().activeAgentRun).toBeUndefined()
  })
})
