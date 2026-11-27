// @vitest-environment happy-dom
import { act, createElement as h, type ComponentProps, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { WorkspaceBrowser } from '../../../apps/studio-client/src/widgets/memory-panel/workspace-browser.js'
import { FileTree } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js'

const longTextEditor = vi.hoisted(() => vi.fn((_props: { disabled?: boolean; value?: string }) => null))
vi.mock('../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js', () => ({ FileTree: vi.fn(() => null) }))
vi.mock('../../../apps/studio-client/src/shared/ui/asset-workbench-layout/asset-workbench-layout.js', () => ({
  AssetWorkbenchLayout: (props: { explorer: ReactNode; children: ReactNode }) => h('div', null, props.explorer, props.children),
}))
vi.mock('../../../apps/studio-client/src/shared/ui/long-text-editor/long-text-editor.js', () => ({ LongTextEditor: longTextEditor }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

async function fixture() {
  vi.mocked(FileTree).mockClear()
  longTextEditor.mockClear()
  const revision = { id: 'revision', timelineId: 'timeline', entries: [
    { id: 'folder', name: 'notes', kind: 'directory' },
    { id: 'memory', name: 'MEMORY.md', kind: 'file', content: { text: 'memory' } },
  ] }
  const mutate = vi.fn().mockResolvedValue({ revision: { ...revision, id: 'next' } })
  const get = vi.fn().mockResolvedValue(revision)
  const api = { workspace: { get, mutate } } as unknown as StudioApi
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  await act(async () => { root.render(h(WorkspaceBrowser, { api, timelineId: 'timeline', branchId: 'branch' })) })
  const tree = () => vi.mocked(FileTree).mock.calls.at(-1)![0] as ComponentProps<typeof FileTree>
  const rootAction = (id: string) => {
    const props = tree()
    const action = props.getActions!(props.nodes[0]).find(item => item.type !== 'separator' && item.id === id)
    if (!action || action.type === 'separator') throw new Error(`Missing root action: ${id}`)
    return action.onSelect?.()
  }
  return { element, get, mutate, tree, rootAction, dispose() { act(() => root.unmount()); element.remove() } }
}

describe('Workspace root node', () => {
  it('belongs to FileTree, supports selection and has root-specific context actions', async () => {
    const f = await fixture()
    try {
      const props = f.tree()
      const root = props.nodes[0]
      expect(root).toMatchObject({ label: '/workspace', kind: 'folder', children: expect.arrayContaining([expect.objectContaining({ id: 'memory' })]) })
      expect(props.expandedIds).toContain(root.id)
      expect(props.getActions!(root).map(action => action.type === 'separator' ? 'separator' : action.id))
        .toEqual(['file', 'directory', 'upload'])
      await act(async () => props.onSelect(root))
      expect(f.tree().selectedId).toBe(root.id)
    } finally { f.dispose() }
  })

  it('creates at the root even when a nested directory is selected', async () => {
    const f = await fixture()
    try {
      await act(async () => f.tree().onSelect(f.tree().nodes[0].children!.find(node => node.id === 'folder')!))
      await act(async () => { f.rootAction('file') })
      const confirm = [...f.element.querySelectorAll('button')].find(button => button.textContent === '确定')!
      await act(async () => confirm.click())
      expect(f.mutate).toHaveBeenCalledWith(expect.objectContaining({ operations: [expect.objectContaining({
        kind: 'create', entry: expect.objectContaining({ parentId: undefined, kind: 'file' }),
      })] }))
    } finally { f.dispose() }
  })

  it('polls in the background without entering a busy state or disabling the editor', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const f = await fixture()
    let finishPoll!: () => void
    try {
      expect(f.get).toHaveBeenCalledTimes(1)
      expect(longTextEditor).toHaveBeenCalled()
      expect(longTextEditor.mock.calls.at(-1)![0]).toMatchObject({ disabled: false })
      f.get.mockImplementationOnce(() => new Promise(resolve => {
        finishPoll = () => resolve({ id: 'revision', timelineId: 'timeline', entries: [
          { id: 'folder', name: 'notes', kind: 'directory' },
          { id: 'memory', name: 'MEMORY.md', kind: 'file', content: { text: 'memory' } },
        ] })
      }))

      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

      const workspace = f.element.querySelector<HTMLElement>('section[aria-label="共享工作区"]')!
      expect(f.get).toHaveBeenCalledTimes(2)
      expect(workspace.getAttribute('aria-busy')).toBe('false')
      expect(f.element.textContent).not.toContain('正在处理…')
      expect(longTextEditor.mock.calls.at(-1)![0]).toMatchObject({ disabled: false })
    } finally {
      if (finishPoll) await act(async () => finishPoll())
      f.dispose()
      vi.useRealTimers()
    }
  })

  it('uploads at the root even when a nested directory is selected', async () => {
    const f = await fixture()
    try {
      await act(async () => f.tree().onSelect(f.tree().nodes[0].children!.find(node => node.id === 'folder')!))
      await act(async () => { f.rootAction('upload') })
      const input = f.element.querySelector<HTMLInputElement>('input[type="file"]')!
      Object.defineProperty(input, 'files', { configurable: true, value: [new File(['uploaded'], 'note.txt', { type: 'text/plain' })] })
      await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(f.mutate).toHaveBeenCalledWith(expect.objectContaining({ operations: [
        expect.objectContaining({ kind: 'create', entry: expect.objectContaining({ parentId: undefined, name: 'note.txt' }) }),
        expect.objectContaining({ kind: 'write', content: 'uploaded' }),
      ] }))
    } finally { f.dispose() }
  })
})
