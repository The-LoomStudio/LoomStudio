// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mountTheWorldPanel } from '../../../extensions/the-world/src/client/panel-view.js'
import { applyJsonPatch, createWorldRoot } from '../../../extensions/the-world/src/world-state.js'

describe('The World map', () => {
  it('shows and selects places below two levels while preserving their parent groups', async () => {
    const world = applyJsonPatch(createWorldRoot(), [
      { op: 'add', path: '/entities/room', value: { components: { place: { name: '房间', parentPlaceId: 'building', description: '三楼的书房' } } } },
      { op: 'add', path: '/entities/country', value: { components: { place: { name: '国家' } } } },
      { op: 'add', path: '/entities/building', value: { components: { place: { name: '楼房', parentPlaceId: 'city' } } } },
      { op: 'add', path: '/entities/city', value: { components: { place: { name: '城市', parentPlaceId: 'country' } } } },
    ])
    const snapshot = { result: { revisionId: 'map-test', state: { theWorld: world } }, status: '', weatherEffectsEnabled: true, themeId: 'default' }
    const host = document.createElement('div')
    document.body.append(host)
    const panel = mountTheWorldPanel(host, { target: { timelineId: 'story', branchId: 'main' }, close() {} }, {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      async setWeatherEffectsEnabled() {},
      async setTheme() {},
    })
    try {
      await expect.poll(() => host.querySelectorAll('.location_card').length).toBe(4)
      const mapTab = [...host.querySelectorAll<HTMLButtonElement>('.tw-tab')].find(button => button.textContent === '地图')!
      mapTab.click()
      await expect.poll(() => host.querySelector('.tw-pane.active .tw-map') !== null).toBe(true)
      expect(host.querySelector('.main_locations')!.textContent).toBe('国家')
      expect(host.querySelector('[data-main="国家"]')!.textContent).toBe('城市')
      expect(host.querySelector('[data-main="城市"]')!.textContent).toBe('楼房')
      const room = host.querySelector<HTMLButtonElement>('[data-main="楼房"] .location_card')!
      expect(room.textContent).toBe('房间')
      room.click()
      await expect.poll(() => room.getAttribute('aria-pressed')).toBe('true')
      expect(host.querySelector('.tw-map > p')!.textContent).toBe('三楼的书房')
    } finally {
      panel.dispose()
      host.remove()
    }
  })
})
