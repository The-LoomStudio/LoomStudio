export type LongTextEditorMode = 'source' | 'preview'

export type LongTextEditorState = {
  copyStatus: 'idle' | 'copied' | 'failed'
  undoValue?: string
}

type LongTextEditorAction =
  | { type: 'copy'; status: 'copied' | 'failed' }
  | { type: 'reset-copy' }
  | { type: 'clear'; value: string }
  | { type: 'edit' | 'undo' | 'expire-undo' }

export const INITIAL_LONG_TEXT_EDITOR_STATE: LongTextEditorState = {
  copyStatus: 'idle',
}

export function reduceLongTextEditorState(
  state: LongTextEditorState,
  action: LongTextEditorAction,
): LongTextEditorState {
  if (action.type === 'copy') return { ...state, copyStatus: action.status }
  if (action.type === 'reset-copy') return { ...state, copyStatus: 'idle' }
  if (action.type === 'clear') return { ...state, undoValue: action.value }
  if (action.type === 'edit' || action.type === 'undo' || action.type === 'expire-undo') {
    return { ...state, undoValue: undefined }
  }
  return state
}
