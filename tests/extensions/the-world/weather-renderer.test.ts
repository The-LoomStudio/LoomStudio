// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createWeatherRenderer } from '../../../extensions/the-world/src/client/weather-renderer.js'

describe('The World weather lifetime', () => {
  it('updates rain density, speed and wind without leaking effects on cleanup', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(.5)
    const background = document.createElement('div')
    const foreground = document.createElement('div')
    const renderer = createWeatherRenderer({
      backgroundLayer: background, foregroundLayer: foreground,
      clouds: { activate() {}, deactivate() {}, setColor() {} },
    })
    try {
      renderer.update({ weatherString: '小雨 微风', periodString: '白天' })
      expect(foreground.querySelectorAll('.particle-rain')).toHaveLength(5)
      expect(parseFloat(foreground.querySelector<HTMLElement>('.particle-rain')!.style.animationDuration)).toBeCloseTo(.75)
      expect(parseFloat(foreground.style.getPropertyValue('--tw-gust-x'))).toBeCloseTo(9.6)

      renderer.update({ weatherString: '暴雨 狂风', periodString: '白天' })
      const heavyRain = foreground.querySelector<HTMLElement>('.particle-rain')!
      expect(foreground.querySelectorAll('.particle-rain')).toHaveLength(8)
      expect(parseFloat(heavyRain.style.animationDuration)).toBeCloseTo(.3)
      expect(heavyRain.classList.contains('angled-strong')).toBe(true)
      vi.advanceTimersByTime(130)
      expect(foreground.querySelectorAll('.particle-rain')).toHaveLength(16)

      renderer.update({ weatherString: '暴雨 狂风', periodString: '白天' })
      expect(foreground.querySelector('.particle-rain')).toBe(heavyRain)
      vi.advanceTimersByTime(2070)
      expect(parseFloat(foreground.style.getPropertyValue('--tw-gust-x'))).toBeCloseTo(24)

      renderer.clear()
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(30_000)
      expect(foreground.childElementCount).toBe(0)
      expect(foreground.style.getPropertyValue('--tw-gust-x')).toBe('')
    } finally {
      renderer.clear()
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  })

  it('cancels particle removal and wind callbacks as well as repeating effects', () => {
    vi.useFakeTimers()
    function node() {
      return Object.assign(new EventTarget(), {
        className: '', style: { cssText: '', setProperty: vi.fn(), removeProperty: vi.fn() },
        classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
        append: vi.fn(), remove: vi.fn(), replaceChildren: vi.fn(), querySelectorAll: () => [], querySelector: () => null,
      })
    }
    vi.stubGlobal('document', { createElement: node })
    vi.stubGlobal('window', globalThis)
    try {
      const foreground = node()
      const clouds = { activate: vi.fn(), deactivate: vi.fn(), setColor: vi.fn() }
      const renderer = createWeatherRenderer({ backgroundLayer: node(), foregroundLayer: foreground, clouds })
      renderer.update({ weatherString: '中雨 大风', periodString: '白天' })
      expect(vi.getTimerCount()).toBeGreaterThan(2)
      vi.advanceTimersByTime(1000)
      renderer.clear()
      expect(vi.getTimerCount()).toBe(0)
      const writes = foreground.style.setProperty.mock.calls.length
      vi.advanceTimersByTime(30_000)
      expect(foreground.style.setProperty).toHaveBeenCalledTimes(writes)
      expect(foreground.replaceChildren).toHaveBeenCalledOnce()
      expect(clouds.deactivate).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers(); vi.unstubAllGlobals() }
  })
})
