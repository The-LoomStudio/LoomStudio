// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast, Toaster } from '../../../apps/studio-client/node_modules/sonner/dist/index.mjs'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  toast.dismiss()
})

describe('notification retirement', () => {
  it('releases dismissed records and their callbacks while preserving active ID updates', () => {
    const action = { label: 'Details', onClick: vi.fn() }
    toast.info('First', { id: 'retention-a', cancel: action })
    toast.info('Updated', { id: 'retention-a', cancel: action })
    toast.info('Other', { id: 'retention-b' })
    expect(toast.getHistory()).toHaveLength(2)
    expect(toast.getHistory().find(item => item.id === 'retention-a')).toMatchObject({ title: 'Updated', cancel: action })
    toast.dismiss('retention-a')
    expect(toast.getHistory().map(item => item.id)).toEqual(['retention-b'])
    expect(toast.getToasts().map(item => item.id)).toEqual(['retention-b'])
    toast.dismiss()
    expect(toast.getHistory()).toEqual([])
  })

  it('releases naturally expired notifications through the real Toaster lifecycle', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(createElement(Toaster, { duration: 20 })))
    await act(async () => { toast.info('Short lived', { id: 'retention-natural', duration: 20 }) })
    expect(container.querySelector('[data-sonner-toast]')).not.toBeNull()
    await vi.waitFor(() => {
      expect(toast.getHistory()).toEqual([])
      expect(container!.querySelector('[data-sonner-toast]')).toBeNull()
    }, { timeout: 1500 })
  })
})
