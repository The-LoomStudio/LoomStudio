import { useState } from 'react'
import { LongTextEditor } from '../../shared/ui/long-text-editor/long-text-editor.js'
import { createTranslator } from '../../shared/i18n/index.js'

const t = createTranslator('zh-CN')

export function LongTextEditorPreview() {
  const [documentId, setDocumentId] = useState<'a' | 'b'>('a')
  const [documents, setDocuments] = useState({ a: 'Document A', b: 'Document B' })
  const [mode, setMode] = useState<'source' | 'preview'>('source')
  const [mounted, setMounted] = useState(true)
  return (
    <main style={{ padding: 24 }}>
      <nav>
        <button onClick={() => setDocumentId('a')}>文档 A</button>
        <button onClick={() => setDocumentId('b')}>文档 B</button>
        <button onClick={() => setMounted(value => !value)}>{mounted ? '结束编辑' : '开始编辑'}</button>
      </nav>
      {mounted ? <LongTextEditor
        key={documentId}
        label={`文档 ${documentId.toUpperCase()}`}
        value={documents[documentId]}
        mode={mode}
        onModeChange={setMode}
        onChange={value => setDocuments(current => ({ ...current, [documentId]: value }))}
        onCommit={() => {}}
        clearLabel={t('longTextEditor.clear')}
        clearedLabel={t('longTextEditor.cleared')}
        copiedLabel={t('longTextEditor.copied')}
        copyFailedLabel={t('longTextEditor.copyFailed')}
        copyLabel={t('longTextEditor.copy')}
        disableCodeWrapLabel={t('markdown.code.disableWrap')}
        enableCodeWrapLabel={t('markdown.code.enableWrap')}
        previewEmptyLabel={t('longTextEditor.previewEmpty')}
        previewModeLabel={t('longTextEditor.previewMode')}
        restoreInitialLabel={t('longTextEditor.restoreInitial')}
        sourceModeLabel={t('longTextEditor.sourceMode')}
        undoEditLabel={t('longTextEditor.undoEdit')}
        undoLabel={t('longTextEditor.undoClear')}
      /> : null}
      <output aria-label="当前文档草稿">{documents[documentId]}</output>
    </main>
  )
}
