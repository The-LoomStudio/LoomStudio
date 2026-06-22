import { createId } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'

describe('shared id generation', () => {
  it('uses restart-safe random identifiers instead of process-local counters', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createId('sample')))

    expect(ids.size).toBe(100)
    for (const id of ids) {
      expect(id).toMatch(/^sample-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
  })
})
