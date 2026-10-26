import { bench, run, summary } from 'mitata'

import type { ContextAssetNode } from '../../apps/studio-client/src/entities/index.js'
import { buildContextAssetSearchIndex, searchContextAssets } from '../../apps/studio-client/src/features/prompt-resources/model/context-asset-search.js'
import { updateContextAssetNode } from '../../apps/studio-client/src/features/prompt-resources/model/tree-ops.js'

const sizes = [500, 5_000, 50_000]
const fixtures = new Map(sizes.map(size => [size, createContextAssetFixture(size)]))
const searchIndexes = new Map(sizes.map(size => [
  size,
  buildContextAssetSearchIndex(readFixture(size)),
]))

summary(() => {
  for (const size of sizes) {
    const nodes = readFixture(size)
    const index = searchIndexes.get(size)!
    const lastId = `entry-${size - 1}`

    bench(`build search index / ${size.toLocaleString('en-US')} nodes`, () => {
      return buildContextAssetSearchIndex(nodes)
    })

    bench(`search context assets / ${size.toLocaleString('en-US')} nodes`, () => {
      return searchContextAssets(index, 'district 42 maintenance')
    })

    bench(`update final node / ${size.toLocaleString('en-US')} nodes`, () => {
      return updateContextAssetNode(nodes, lastId, { body: 'Updated benchmark body.' })
    })


  }
})

await run({ throw: true })

function createContextAssetFixture(size: number): ContextAssetNode[] {
  const children = Array.from({ length: size }, (_, index): ContextAssetNode => ({
    id: `entry-${index}`,
    kind: 'entry',
    label: `District ${index}`,
    meta: index % 5 === 0 ? 'lore location maintenance' : 'lore location',
    body: `Archive entry ${index}. The maintenance gate belongs to district ${index % 100}.`,
    projection: {
      lifecycle: 'always',
      order: `entry: ${index * 10}`,
      slotKey: 'lore:benchmark@lore.stable',
      sourceKind: 'actual',
      zoneId: 'lore.stable',
      entryOrder: index * 10,
    },
  }))

  return [{
    id: 'benchmark-root',
    kind: 'module',
    category: 'lore',
    label: 'Benchmark Lore',
    children,
  }]
}

function readFixture(size: number): ContextAssetNode[] {
  const fixture = fixtures.get(size)
  if (!fixture) throw new Error(`Missing context asset benchmark fixture: ${size}`)
  return fixture
}
