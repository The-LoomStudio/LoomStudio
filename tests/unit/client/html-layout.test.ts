import { describe, expect, it } from 'vitest'
import { createHtmlHeightCache } from '../../../apps/studio-client/src/features/message-content/model/html-layout.js'

describe('Message HTML layout', () => {
  it('bounds cached content and reuses only exact content/width/theme identities', () => {
    const cache = createHtmlHeightCache()
    const key = JSON.stringify(['html', 600, 'dark'])
    cache.write(key, 450)
    expect(cache.read(JSON.stringify(['html', 400, 'dark']))).toBeUndefined()
    expect(cache.read(JSON.stringify(['html', 600, 'light']))).toBeUndefined()
    expect(cache.read(key)).toBe(450)
    for (let index = 0; index < 32; index++) cache.write(String(index), 100)
    expect(cache.read(key)).toBeUndefined()
    cache.write('x'.repeat(1_000_001), 500)
    expect(cache.read('x'.repeat(1_000_001))).toBeUndefined()
    cache.write('a'.repeat(600_000), 200)
    cache.write('b'.repeat(600_000), 300)
    expect(cache.read('a'.repeat(600_000))).toBeUndefined()
    expect(cache.read('b'.repeat(600_000))).toBe(300)
  })
})
