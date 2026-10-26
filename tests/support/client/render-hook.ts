import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

export function renderHook<T>(hook: () => T, wrapper: (child: ReactNode) => ReactNode = child => child) {
  let result!: T
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  function TestComponent() {
    result = hook()
    return null
  }

  const rerender = () => act(() => root.render(wrapper(createElement(TestComponent))))
  rerender()

  return {
    rerender,
    get current() {
      return result
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}
