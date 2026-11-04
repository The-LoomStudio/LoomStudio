import { describe, expect, it } from 'vitest'
import { createStateContentRegistry } from '../../packages/application-runtime/src/state/state-content-registry.js'
import { installedExtensionContributionId } from '@loom-studio/extension-sdk'

describe('State content registrations', () => {
  it('requires explicit adopted contribution identity and isolates Card installations', async () => {
    const registry = createStateContentRegistry()
    const target = { kind: 'card' as const, cardId: 'a' }
    const contributionId = installedExtensionContributionId('example', target, 'example.data')
    registry.register({
      id: 'example/update', contributionId: 'example.data', path: '/data',
      async process() { return { value: { hp: 2 } } },
    }, { packageId: 'example', target })
    const input = { text: 'set', value: { data: { hp: 1 } }, signal: new AbortController().signal }
    expect((await registry.process({ ...input, cardId: 'a', contributionIds: [] })).operations).toEqual([])
    expect((await registry.process({ ...input, cardId: 'b', contributionIds: [contributionId] })).operations).toEqual([])
    expect((await registry.process({ ...input, cardId: 'a', contributionIds: [contributionId] })).operations)
      .toEqual([{ op: 'set', path: '/data', value: { hp: 2 } }])
    expect(input.value).toEqual({ data: { hp: 1 } })
  })

  it('requires the current adopted address', async () => {
    const registry = createStateContentRegistry()
    registry.register({
      id: 'example/update', contributionId: 'example.data', path: '/mvu',
      async process({ value }) { return { value: { hp: Number(value.hp) - 3 } } },
    }, { packageId: 'example', target: { kind: 'global' } })
    const process = (value: import('@loom-studio/shared').JsonObject) => registry.process({
      text: 'damage', value, contributionIds: ['example.data'], signal: new AbortController().signal,
    })
    await expect(process({ old: { data: { hp: 10 } } })).rejects.toThrow('data is missing: /mvu')
    expect((await process({ mvu: { hp: 5 }, old: { data: { hp: 10 } } })).operations)
      .toEqual([{ op: 'set', path: '/mvu', value: { hp: 2 } }])
    await expect(process({ mvu: null, old: { data: { hp: 10 } } })).rejects.toThrow('data is missing: /mvu')
  })

  it('does not accept results from an unloaded handler', async () => {
    const registry = createStateContentRegistry()
    let complete!: () => void
    const pending = new Promise<void>(resolve => { complete = resolve })
    const registration = registry.register({
      id: 'example/update', contributionId: 'example.data', path: '/data',
      async process() { await pending; return { value: { hp: 2 } } },
    }, { packageId: 'example', target: { kind: 'global' } })
    const result = registry.process({
      text: 'set', value: { data: { hp: 1 } }, contributionIds: ['example.data'], signal: new AbortController().signal,
    })
    registration.dispose()
    complete()
    await expect(result).rejects.toThrow()
  })
})
