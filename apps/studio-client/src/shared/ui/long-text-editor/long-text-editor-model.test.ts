import { describe, expect, it } from 'vitest'
import { INITIAL_LONG_TEXT_EDITOR_STATE, reduceLongTextEditorState } from './long-text-editor-model.js'

describe('long text editor transient state', () => {
  it('keeps cleared text available until undo or a new edit', () => {
    const cleared = reduceLongTextEditorState(INITIAL_LONG_TEXT_EDITOR_STATE, { type: 'clear', value: 'before' })

    expect(cleared.undoValue).toBe('before')
    expect(reduceLongTextEditorState(cleared, { type: 'undo' }).undoValue).toBeUndefined()
    expect(reduceLongTextEditorState(cleared, { type: 'edit' }).undoValue).toBeUndefined()
    expect(reduceLongTextEditorState(cleared, { type: 'expire-undo' }).undoValue).toBeUndefined()
  })

  it('tracks and resets clipboard feedback', () => {
    const copied = reduceLongTextEditorState(INITIAL_LONG_TEXT_EDITOR_STATE, { type: 'copy', status: 'copied' })

    expect(copied.copyStatus).toBe('copied')
    expect(reduceLongTextEditorState(copied, { type: 'reset-copy' }).copyStatus).toBe('idle')
  })
})
