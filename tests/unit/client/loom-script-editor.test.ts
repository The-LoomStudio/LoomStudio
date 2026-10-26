// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CodeMirrorEditor, type CodeMirrorEditorHandle } from '../../../apps/studio-client/src/shared/ui/long-text-editor/code-mirror-editor.js'
import { LoomScriptSourceFields } from '../../../apps/studio-client/src/features/loom-scripts/ui/loom-script-source-fields.js'
import { createTextRuleScriptTemplate } from '../../../apps/studio-client/src/features/loom-scripts/model/script-template.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

let root: ReturnType<typeof createRoot> | undefined
afterEach(() => { if (root) flushSync(() => root!.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })

it('uses JavaScript language while keeping multiline metadata readable and navigable without rewriting source', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const ref = createRef<CodeMirrorEditorHandle>()
  const source = '// ==LoomScript==\n// @setting {\n//   "key": "message", "default": "你好"\n// }\n// ==/LoomScript==\nexport function activate(ctx) { return ctx.scriptSettings.message }'
  const onChange = vi.fn()
  flushSync(() => root!.render(createElement(CodeMirrorEditor, { ref, language: 'loom-script', labelledBy: 'source', value: source, onChange, onCommit: vi.fn() })))
  expect(host.querySelector('.cm-loom-metadata-field')?.textContent).toBe('@setting')
  expect([...host.querySelectorAll('.cm-loom-metadata-property')].map(item => item.textContent)).toContain('"key"')
  expect([...host.querySelectorAll('.cm-loom-metadata-string')].map(item => item.textContent)).toContain('"你好"')
  await vi.waitFor(() => expect([...host.querySelectorAll('.cm-line:last-child span')].map(item => item.textContent)).toContain('export'))
  ref.current!.revealLine(3)
  expect(document.activeElement).toBe(host.querySelector('.cm-content'))
  expect(host.querySelector('.cm-content')?.textContent).toBe(source.replaceAll('\n', ''))
  expect(onChange).not.toHaveBeenCalled()
})

it('previews the complete unsaved rule source and shows the result without saving or changing it', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const source = createTextRuleScriptTemplate()
  const onSourceChange = vi.fn()
  const onPreview = vi.fn(async () => ({ output: '替换后文字', matches: [{ ruleId: 'replace', match: '待替换文字' }], diagnostics: [] }))
  await act(async () => root!.render(createElement(LoomScriptSourceFields, {
    source, fileName: 'new-rule.loom.js', onSourceChange, onFileNameChange: vi.fn(), onPreview, t: createTranslator('zh-CN'),
  })))
  expect(host.querySelector('[aria-label="规则摘要"]')?.textContent).toContain('替换示例')
  const input = host.querySelector<HTMLTextAreaElement>('[aria-label="规则测试样本文本"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '待替换文字')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '测试规则')!.click())
  expect(onPreview).toHaveBeenCalledWith({ source, text: '待替换文字', phase: 'display' })
  expect(host.querySelector('pre')?.textContent).toBe('替换后文字')
  expect(onSourceChange).not.toHaveBeenCalled()
})
